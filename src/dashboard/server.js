const express = require('express');
const cors = require('cors');
const config = require('../config');
const log = require('../utils/logger');
const store = require('../database/store');
const { db } = store;

function startDashboard(client) {
  const app = express();
  app.use(cors({
    origin: process.env.DASHBOARD_URL || 'http://localhost:5173',
    credentials: true,
  }));
  app.use(express.json());

  // In-memory rate limiter
  const rateLimits = new Map();
  // Keys include the raw Authorization header, so any client can mint new
  // keys; evict expired windows so the map cannot grow without bound.
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimits) {
      if (now > entry.resetAt) rateLimits.delete(key);
    }
  }, 60000).unref();

  function rateLimit(windowMs = 60000, max = 60) {
    return (req, res, next) => {
      const key = `${windowMs}:${max}:${req.ip}`; // never the token: callers could rotate fake tokens to dodge the limit
      const now = Date.now();
      const entry = rateLimits.get(key) || { count: 0, resetAt: now + windowMs };
      if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
      entry.count++;
      rateLimits.set(key, entry);
      if (entry.count > max) return res.status(429).json({ error: 'Rate limited' });
      next();
    };
  }

  // Liveness probe for Docker/uptime monitors. Reports only whether the gateway connection is up; no data.
  app.get('/healthz', (req, res) => {
    const ready = client.isReady();
    res.status(ready ? 200 : 503).json({ ok: ready });
  });

  // Apply rate limits — stricter for write endpoints, relaxed for reads
  app.use('/api', rateLimit(60000, 60));

  // API auth middleware — checks Discord OAuth token
  // The token must be a real, live Discord OAuth token: it is verified against Discord (result cached for 60s)
  // so a made-up "Bearer x" can never reach a route. Routes that touch a guild additionally check Manage Server.
  const tokenCache = new Map(); // token -> { user, expiresAt }
  setInterval(() => {
    const now = Date.now();
    for (const [t, e] of tokenCache) if (now > e.expiresAt) tokenCache.delete(t);
  }, 60000).unref();

  async function authMiddleware(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token || token.length > 256) return res.status(401).json({ error: 'No token' });

    let entry = tokenCache.get(token);
    if (!entry || Date.now() > entry.expiresAt) {
      const user = await fetchUser(token).catch(() => null);
      if (!user?.id) { tokenCache.delete(token); return res.status(401).json({ error: 'Invalid token' }); }
      entry = { user, expiresAt: Date.now() + 60000 };
      tokenCache.set(token, entry);
    }
    req.token = token;
    req.user = entry.user;
    next();
  }

  // Get user info from Discord
  async function fetchUser(token) {
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return res.json();
  }

  // Get user's guilds
  async function fetchGuilds(token) {
    const res = await fetch('https://discord.com/api/v10/users/@me/guilds', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    return res.json();
  }

  // OAuth callback info
  app.get('/api/auth/info', (req, res) => {
    res.json({
      clientId: config.discord.clientId,
      redirectUri: config.dashboard.callbackUrl,
    });
  });

  // Exchange code for token
  app.post('/api/auth/callback', async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'No code' });

    try {
      const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.discord.clientId,
          client_secret: process.env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: config.dashboard.callbackUrl,
        }),
      });

      if (!tokenRes.ok) return res.status(400).json({ error: 'Token exchange failed' });
      const data = await tokenRes.json();
      res.json({ access_token: data.access_token });
    } catch {
      res.status(500).json({ error: 'Auth failed' });
    }
  });

  // Get current user
  app.get('/api/user', authMiddleware, async (req, res) => {
    const user = await fetchUser(req.token);
    if (!user) return res.status(401).json({ error: 'Invalid token' });
    res.json(user);
  });

  // Get guilds where user has Manage Guild + bot is present
  app.get('/api/guilds', authMiddleware, async (req, res) => {
    const guilds = await fetchGuilds(req.token);
    const manageable = guilds.filter((g) => (g.permissions & 0x20) === 0x20);
    const botGuilds = client.guilds.cache;
    const mutual = manageable.filter((g) => botGuilds.has(g.id));
    res.json(mutual.map((g) => ({ id: g.id, name: g.name, icon: g.icon })));
  });

  // Get guild config
  app.get('/api/guilds/:id/config', authMiddleware, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const guilds = await fetchGuilds(req.token);
    const hasAccess = guilds.some((g) => g.id === req.params.id && (g.permissions & 0x20) === 0x20);
    if (!hasAccess) return res.status(403).json({ error: 'No access' });

    const keys = [
      'prefix', 'welcome_channel', 'welcome_message', 'welcome_card',
      'goodbye_channel', 'goodbye_message', 'goodbye_card',
      'modlog_channel', 'logging_channel', 'levelup_channel',
      'leveling', 'antispam', 'antilink', 'ai_automod', 'word_filter',
    ];

    const cfg = {};
    for (const key of keys) {
      cfg[key] = store.getConfig(req.params.id, key);
    }
    cfg.name = guild.name;
    cfg.icon = guild.iconURL();
    cfg.memberCount = guild.memberCount;

    res.json(cfg);
  });

  // Update guild config
  app.patch('/api/guilds/:id/config', authMiddleware, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const guilds = await fetchGuilds(req.token);
    const hasAccess = guilds.some((g) => g.id === req.params.id && (g.permissions & 0x20) === 0x20);
    if (!hasAccess) return res.status(403).json({ error: 'No access' });

    const allowed = [
      'prefix', 'welcome_channel', 'welcome_message', 'welcome_card',
      'goodbye_channel', 'goodbye_message', 'goodbye_card',
      'modlog_channel', 'logging_channel', 'levelup_channel',
      'leveling', 'antispam', 'antilink', 'ai_automod', 'word_filter',
    ];

    for (const [key, value] of Object.entries(req.body)) {
      if (allowed.includes(key)) {
        store.setConfig(req.params.id, key, value);
      }
    }

    res.json({ success: true });
  });

  // Guild stats
  app.get('/api/guilds/:id/stats', authMiddleware, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    res.json({
      members: guild.memberCount,
      channels: guild.channels.cache.size,
      roles: guild.roles.cache.size,
      boosts: guild.premiumSubscriptionCount || 0,
    });
  });

  // AI chat endpoint for web assistant
  app.post('/api/ai/chat', rateLimit(60000, 10), authMiddleware, async (req, res) => {
    const { chatWithHistory } = require('../utils/ai');
    const { message, history } = req.body;
    if (!message) return res.status(400).json({ error: 'No message' });

    const response = await chatWithHistory(message, history || []);
    if (!response) return res.status(503).json({ error: 'AI unavailable', response: 'AI service is currently unavailable. Make sure GROQ_API_KEY is configured.' });
    res.json({ response });
  });

  // Get all warnings for guild
  app.get('/api/guilds/:id/warnings', authMiddleware, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const guilds = await fetchGuilds(req.token);
    const hasAccess = guilds.some((g) => g.id === req.params.id && (g.permissions & 0x20) === 0x20);
    if (!hasAccess) return res.status(403).json({ error: 'No access' });

    try {
      const rows = db.prepare('SELECT * FROM warnings WHERE guild_id = ? ORDER BY id DESC').all(req.params.id);
      const warnings = rows.map((w) => {
        const user = client.users.cache.get(w.user_id);
        const mod = client.users.cache.get(w.moderator);
        return {
          id: w.id,
          userId: w.user_id,
          username: user ? user.username : w.user_id,
          avatar: user ? user.displayAvatarURL({ size: 32 }) : null,
          moderator: w.moderator,
          moderatorName: mod ? mod.username : w.moderator,
          moderatorAvatar: mod ? mod.displayAvatarURL({ size: 32 }) : null,
          reason: w.reason,
          timestamp: w.timestamp,
        };
      });
      res.json(warnings);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch warnings' });
    }
  });

  // Delete a warning
  app.delete('/api/guilds/:id/warnings/:wid', authMiddleware, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const guilds = await fetchGuilds(req.token);
    const hasAccess = guilds.some((g) => g.id === req.params.id && (g.permissions & 0x20) === 0x20);
    if (!hasAccess) return res.status(403).json({ error: 'No access' });

    try {
      const info = db.prepare('DELETE FROM warnings WHERE id = ? AND guild_id = ?').run(req.params.wid, req.params.id);
      if (info.changes === 0) return res.status(404).json({ error: 'Warning not found' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete warning' });
    }
  });

  // Get all notes for guild
  app.get('/api/guilds/:id/notes', authMiddleware, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const guilds = await fetchGuilds(req.token);
    const hasAccess = guilds.some((g) => g.id === req.params.id && (g.permissions & 0x20) === 0x20);
    if (!hasAccess) return res.status(403).json({ error: 'No access' });

    try {
      const rows = db.prepare('SELECT * FROM notes WHERE guild_id = ? ORDER BY id DESC').all(req.params.id);
      const notes = rows.map((n) => {
        const user = client.users.cache.get(n.user_id);
        const mod = client.users.cache.get(n.moderator);
        return {
          id: n.id,
          userId: n.user_id,
          username: user ? user.username : n.user_id,
          avatar: user ? user.displayAvatarURL({ size: 32 }) : null,
          moderator: n.moderator,
          moderatorName: mod ? mod.username : n.moderator,
          moderatorAvatar: mod ? mod.displayAvatarURL({ size: 32 }) : null,
          content: n.content,
          timestamp: n.timestamp,
        };
      });
      res.json(notes);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch notes' });
    }
  });

  // Delete a note
  app.delete('/api/guilds/:id/notes/:nid', authMiddleware, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const guilds = await fetchGuilds(req.token);
    const hasAccess = guilds.some((g) => g.id === req.params.id && (g.permissions & 0x20) === 0x20);
    if (!hasAccess) return res.status(403).json({ error: 'No access' });

    try {
      const info = db.prepare('DELETE FROM notes WHERE id = ? AND guild_id = ?').run(req.params.nid, req.params.id);
      if (info.changes === 0) return res.status(404).json({ error: 'Note not found' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete note' });
    }
  });

  // Mod stats — count of warns/bans/notes per moderator
  app.get('/api/guilds/:id/modstats', authMiddleware, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const guilds = await fetchGuilds(req.token);
    const hasAccess = guilds.some((g) => g.id === req.params.id && (g.permissions & 0x20) === 0x20);
    if (!hasAccess) return res.status(403).json({ error: 'No access' });

    try {
      const warnStats = db.prepare(
        'SELECT moderator, COUNT(*) as count FROM warnings WHERE guild_id = ? GROUP BY moderator'
      ).all(req.params.id);

      const noteStats = db.prepare(
        'SELECT moderator, COUNT(*) as count FROM notes WHERE guild_id = ? GROUP BY moderator'
      ).all(req.params.id);

      // Merge into a single map per moderator
      const statsMap = {};
      for (const row of warnStats) {
        if (!statsMap[row.moderator]) statsMap[row.moderator] = { warnings: 0, notes: 0 };
        statsMap[row.moderator].warnings = row.count;
      }
      for (const row of noteStats) {
        if (!statsMap[row.moderator]) statsMap[row.moderator] = { warnings: 0, notes: 0 };
        statsMap[row.moderator].notes = row.count;
      }

      const stats = Object.entries(statsMap).map(([modId, counts]) => {
        const mod = client.users.cache.get(modId);
        return {
          moderator: modId,
          moderatorName: mod ? mod.username : modId,
          moderatorAvatar: mod ? mod.displayAvatarURL({ size: 32 }) : null,
          warnings: counts.warnings,
          notes: counts.notes,
          total: counts.warnings + counts.notes,
        };
      }).sort((a, b) => b.total - a.total);

      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch mod stats' });
    }
  });

  // Helper: verify guild access
  async function verifyGuildAccess(req, res) {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) { res.status(404).json({ error: 'Guild not found' }); return null; }
    const guilds = await fetchGuilds(req.token);
    const hasAccess = guilds.some((g) => g.id === req.params.id && (g.permissions & 0x20) === 0x20);
    if (!hasAccess) { res.status(403).json({ error: 'No access' }); return null; }
    return guild;
  }

  // XP leaderboard (top 50)
  app.get('/api/guilds/:id/leaderboard', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;

    const xpDb = require('../database/xp');
    const rows = xpDb.getLeaderboard(req.params.id, 50);
    const leaderboard = rows.map((r, i) => {
      const level = r.level;
      const needed = xpDb.xpForLevel(level);
      let currentXp = r.totalXp;
      for (let l = 0; l < level; l++) currentXp -= xpDb.xpForLevel(l);
      const user = client.users.cache.get(r.userId);
      return {
        rank: i + 1,
        userId: r.userId,
        username: user ? user.username : null,
        avatar: user ? user.displayAvatarURL({ size: 32 }) : null,
        level,
        totalXp: r.totalXp,
        currentXp,
        needed,
      };
    });
    res.json(leaderboard);
  });

  // Set user XP/level
  app.patch('/api/guilds/:id/xp/:userId', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;

    const xpDb = require('../database/xp');
    const { xp, level } = req.body;

    let result;
    if (level !== undefined) {
      result = xpDb.setLevel(req.params.id, req.params.userId, level);
    } else if (xp !== undefined) {
      result = xpDb.setXp(req.params.id, req.params.userId, xp);
    } else {
      return res.status(400).json({ error: 'Provide xp or level' });
    }
    res.json(result);
  });

  // Get leveling config
  app.get('/api/guilds/:id/leveling-config', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;

    res.json({
      enabled: store.getConfig(req.params.id, 'leveling') !== false,
      levelup_channel: store.getConfig(req.params.id, 'levelup_channel'),
      xp_multiplier: store.getConfig(req.params.id, 'xp_multiplier') || 1,
      level_roles: store.getConfig(req.params.id, 'level_roles') || [],
      no_xp_channels: store.getConfig(req.params.id, 'no_xp_channels') || [],
      no_xp_roles: store.getConfig(req.params.id, 'no_xp_roles') || [],
    });
  });

  // Update leveling config
  app.patch('/api/guilds/:id/leveling-config', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;

    const allowed = ['enabled', 'levelup_channel', 'xp_multiplier', 'level_roles', 'no_xp_channels', 'no_xp_roles'];
    for (const [key, value] of Object.entries(req.body)) {
      if (!allowed.includes(key)) continue;
      if (key === 'enabled') {
        store.setConfig(req.params.id, 'leveling', value);
      } else {
        store.setConfig(req.params.id, key, value);
      }
    }
    res.json({ success: true });
  });

  // List custom commands for a guild
  app.get('/api/guilds/:id/custom-commands', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;
    try {
      const cmds = store.listCustomCommands(req.params.id);
      res.json(cmds.map(([name, data]) => ({ name, response: data.response, embed: data.embed })));
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch custom commands' });
    }
  });

  // Create custom command
  app.post('/api/guilds/:id/custom-commands', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;
    const { name, response } = req.body;
    if (!name || !response) return res.status(400).json({ error: 'Name and response are required' });
    if (name.length > 32) return res.status(400).json({ error: 'Name must be 32 characters or less' });
    if (response.length > 2000) return res.status(400).json({ error: 'Response must be 2000 characters or less' });
    try {
      store.addCustomCommand(req.params.id, name, { response, embed: false });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to create custom command' });
    }
  });

  // Delete custom command
  app.delete('/api/guilds/:id/custom-commands/:name', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;
    try {
      const removed = store.removeCustomCommand(req.params.id, req.params.name);
      if (!removed) return res.status(404).json({ error: 'Command not found' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete custom command' });
    }
  });

  // Get automod config
  app.get('/api/guilds/:id/automod-config', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;
    const automodKeys = [
      'antispam', 'antispam_threshold', 'antispam_action', 'antispam_duration',
      'antilink', 'antilink_whitelist',
      'word_filter', 'word_filter_list',
    ];
    const cfg = {};
    for (const key of automodKeys) {
      cfg[key] = store.getConfig(req.params.id, key);
    }
    res.json(cfg);
  });

  // Update automod config
  app.patch('/api/guilds/:id/automod-config', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;
    const allowed = [
      'antispam', 'antispam_threshold', 'antispam_action', 'antispam_duration',
      'antilink', 'antilink_whitelist',
      'word_filter', 'word_filter_list',
    ];
    for (const [key, value] of Object.entries(req.body)) {
      if (allowed.includes(key)) {
        store.setConfig(req.params.id, key, value);
      }
    }
    res.json({ success: true });
  });

  // Economy leaderboard — top 50 users by wallet + bank
  app.get('/api/guilds/:id/economy', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;

    try {
      const rows = db.prepare(
        'SELECT user_id, wallet, bank, (wallet + bank) as total FROM economy WHERE guild_id = ? ORDER BY total DESC LIMIT 50'
      ).all(req.params.id);
      res.json(rows);
    } catch {
      res.json([]);
    }
  });

  // Get specific user's economy data
  app.get('/api/guilds/:id/economy/:userId', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;

    const data = store.getBalance(req.params.id, req.params.userId);
    res.json(data);
  });

  // Admin adjust user's wallet/bank
  app.patch('/api/guilds/:id/economy/:userId', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;

    const { wallet, bank } = req.body;
    const current = store.getBalance(req.params.id, req.params.userId);

    const newWallet = typeof wallet === 'number' ? wallet : current.wallet;
    const newBank = typeof bank === 'number' ? bank : current.bank;

    // Adjust wallet and bank to desired values
    const e = store.getBalance(req.params.id, req.params.userId);
    store.addWallet(req.params.id, req.params.userId, newWallet - e.wallet);
    const updated = store.getBalance(req.params.id, req.params.userId);
    store.addBank(req.params.id, req.params.userId, newBank - updated.bank);

    const final = store.getBalance(req.params.id, req.params.userId);
    res.json(final);
  });

  // Get shop items
  app.get('/api/guilds/:id/shop', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;

    const items = [
      { id: 'fishing_rod', name: 'Fishing Rod', price: 500, emoji: '🎣', description: 'Go fishing for extra income' },
      { id: 'laptop', name: 'Laptop', price: 2000, emoji: '💻', description: 'Work from home for more money' },
      { id: 'shield', name: 'Rob Shield', price: 3000, emoji: '🛡️', description: 'Protect against robbery for 1 hour' },
      { id: 'lucky_coin', name: 'Lucky Coin', price: 1500, emoji: '🍀', description: 'Better gambling odds for 30 minutes' },
      { id: 'bank_note', name: 'Bank Note', price: 5000, emoji: '💵', description: 'Increase bank capacity by ⌴ 10,000' },
    ];

    res.json(items);
  });

  // Bot stats
  app.get('/api/stats', authMiddleware, (req, res) => {
    res.json({
      guilds: client.guilds.cache.size,
      users: client.guilds.cache.reduce((a, g) => a + g.memberCount, 0),
      commands: client.commands.size,
      uptime: process.uptime(),
    });
  });

  const port = config.dashboard.port;
  app.listen(port, () => log.info(`API server running on port ${port}`));
  return app;
}

module.exports = { startDashboard };
