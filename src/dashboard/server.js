const express = require('express');
const cors = require('cors');
const config = require('../config');
const log = require('../utils/logger');
const V = require('./validate');
const OAuth = require('./oauthState');
const crypto = require('crypto');

// deps.store is injectable so tests never open the live SQLite file.
function createApp(client, deps = {}) {
  const store = deps.store || require('../database/store');
  const db = deps.db || store.db;
  const app = express();
  app.disable('x-powered-by');
  // Behind Caddy/nginx every request would otherwise share the proxy's IP (one rate-limit bucket for everyone).
  app.set('trust proxy', V.parseTrustProxy(process.env.TRUST_PROXY));
  app.use(cors({
    origin: process.env.DASHBOARD_URL || 'http://localhost:5173',
    credentials: true,
  }));
  app.use(express.json({ limit: '100kb' }));

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

  // Returns true while under the limit. `key` must never contain a raw token (callers could rotate fake ones).
  function hit(key, windowMs, max) {
    const now = Date.now();
    const entry = rateLimits.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
    entry.count++;
    rateLimits.set(key, entry);
    return entry.count <= max;
  }

  // Per-IP limiter (runs before auth, so it only knows the IP).
  function rateLimit(windowMs = 60000, max = 60) {
    return (req, res, next) => {
      if (!hit(`ip:${windowMs}:${max}:${req.ip}`, windowMs, max)) return res.status(429).json({ error: 'Rate limited' });
      next();
    };
  }

  // Per-user limiter (runs after auth): one user behind a shared IP cannot starve others, and one user
  // cannot dodge limits by switching IPs.
  function userRateLimit(windowMs, max, name) {
    return (req, res, next) => {
      if (!hit(`user:${name}:${req.user.id}`, windowMs, max)) return res.status(429).json({ error: 'Rate limited' });
      next();
    };
  }

  // Health probe for Docker/uptime monitors. Gateway state, ws ping, a trivial DB read and uptime; no ids,
  // names, tokens or config. 503 unless both Discord is ready and the database answers.
  app.get('/healthz', (req, res) => {
    const ready = !!client.isReady?.();
    let dbOk = false;
    try { dbOk = db.prepare('SELECT 1 AS ok').get()?.ok === 1; } catch { dbOk = false; }
    const ping = Number(client.ws?.ping);
    const ok = ready && dbOk;
    res.set('Cache-Control', 'no-store');
    res.status(ok ? 200 : 503).json({
      ok,
      discord: { ready, wsPingMs: Number.isFinite(ping) && ping >= 0 ? Math.round(ping) : null },
      db: { ok: dbOk },
      uptimeSeconds: Math.floor(process.uptime()),
      // Booleans and counts only: never keys, ids or names.
      providers: healthProviders(),
      commands: Number(client.commands?.size) || 0,
      lastBackupAt: healthLastBackup(),
      sharding: { sharded: !!client.shard, note: 'single process; see docs/operations.md' },
    });
  });

  function healthProviders() {
    try {
      const p = require('../utils/ai').getProviderStatus();
      return { groq: !!p.groq, gemini: !!p.gemini };
    } catch { return { groq: false, gemini: false }; }
  }
  function healthLastBackup() {
    try { return require('../utils/backup').lastBackupAt(); } catch { return null; }
  }

  // Three public numbers for the marketing site. Counts only, no user or server data; cached so a busy
  // landing page costs nothing. (The detailed /api/stats stays behind auth.)
  let publicStats = { at: 0, body: null };
  app.get('/api/public-stats', (req, res) => {
    if (!client.isReady()) return res.status(503).json({ error: 'starting' });
    if (Date.now() - publicStats.at > 30000) {
      publicStats = {
        at: Date.now(),
        body: { servers: client.guilds.cache.size, commands: client.commands.size, uptimeSeconds: Math.floor(process.uptime()) },
      };
    }
    res.set('Cache-Control', 'public, max-age=30').json(publicStats.body);
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
      // the token must have been issued to THIS application, not just any Discord OAuth app
      const ok = await verifyTokenApp(token).catch(() => false);
      const user = ok ? await fetchUser(token).catch(() => null) : null;
      if (!user?.id) { tokenCache.delete(token); return res.status(401).json({ error: 'Invalid token' }); }
      entry = { user, expiresAt: Date.now() + 60000 };
      tokenCache.set(token, entry);
    }
    req.token = token;
    req.user = entry.user;
    if (!hit(`user:api:${entry.user.id}`, 60000, 120)) return res.status(429).json({ error: 'Rate limited' });
    next();
  }

  async function verifyTokenApp(token) {
    const res = await fetch('https://discord.com/api/v10/oauth2/@me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data?.application?.id || data.application.id !== config.discord.clientId) return false;
    return !!data.expires && new Date(data.expires).getTime() > Date.now();
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
  const guildCache = new Map(); // token -> { guilds, expiresAt } (short TTL so Discord is not hit on every call)
  setInterval(() => {
    const now = Date.now();
    for (const [t, e] of guildCache) if (now > e.expiresAt) guildCache.delete(t);
  }, 60000).unref();

  async function fetchGuilds(token) {
    const cached = guildCache.get(token);
    if (cached && Date.now() < cached.expiresAt) return cached.guilds;
    // Discord returns at most 200 per page; follow `after` until a short page (capped at 10 pages = 2000 guilds).
    const guilds = [];
    for (let page = 0; page < 10; page++) {
      const after = guilds.length ? `&after=${guilds[guilds.length - 1].id}` : '';
      const res = await fetch(`https://discord.com/api/v10/users/@me/guilds?limit=200${after}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { if (page === 0) return []; break; }
      const batch = await res.json();
      if (!Array.isArray(batch)) { if (page === 0) return []; break; }
      guilds.push(...batch);
      if (batch.length < 200) break;
    }
    guildCache.set(token, { guilds, expiresAt: Date.now() + 15000 });
    return guilds;
  }

  // Manage Server (or Administrator/owner) in at least one guild the bot is in.
  async function managesAnyBotGuild(token) {
    const guilds = await fetchGuilds(token);
    return guilds.some((g) => client.guilds.cache.has(g.id) && V.canManageGuild(g));
  }

  // OAuth callback info
  app.get('/api/auth/info', (req, res) => {
    res.json({
      clientId: config.discord.clientId,
      redirectUri: config.dashboard.callbackUrl,
    });
  });

  // OAuth state (CSRF): minted here, carried in a signed httpOnly cookie, checked once on the callback.
  // See src/dashboard/oauthState.js. The cookie key is derived from SESSION_SECRET, never the secret itself.
  // Without a real SESSION_SECRET (dev default is public) use a random per-process key: a restart only voids
  // logins that are mid-flight (10 minute window), and nobody can forge a state cookie.
  const oauthSecret = deps.oauthSecret
    || (process.env.SESSION_SECRET
      ? crypto.createHmac('sha256', process.env.SESSION_SECRET).update('sonder-oauth-state-v1').digest('hex')
      : crypto.randomBytes(32).toString('hex'));
  const oauthState = OAuth.createStateManager({ secret: oauthSecret, now: deps.now });
  const cookieSecure = (req) => req.secure || /^https:/i.test(config.dashboard.callbackUrl || '') || process.env.COOKIE_SECURE === '1';

  // Start login: sets the state cookie and sends the browser to Discord. The website links here directly.
  app.get('/api/auth/login', (req, res) => {
    if (!config.discord.clientId) return res.status(503).json({ error: 'Login is not configured' });
    const { state, cookieValue } = oauthState.issue();
    res.set('Set-Cookie', OAuth.setCookieHeader(cookieValue, { secure: cookieSecure(req) }));
    res.set('Cache-Control', 'no-store');
    const params = new URLSearchParams({
      client_id: config.discord.clientId,
      redirect_uri: config.dashboard.callbackUrl,
      response_type: 'code',
      scope: 'identify guilds',
      state,
    });
    res.redirect(302, `https://discord.com/oauth2/authorize?${params}`);
  });

  // Exchange code for token
  app.post('/api/auth/callback', async (req, res) => {
    const code = req.body?.code;
    if (!code || typeof code !== 'string' || code.length > 512) return res.status(400).json({ error: 'No code' });

    // State first: an unverified callback never reaches Discord. The cookie is single-use either way.
    const cookie = OAuth.parseCookies(req.headers.cookie)[OAuth.COOKIE_NAME];
    const check = oauthState.verify(cookie, req.body?.state);
    res.append('Set-Cookie', OAuth.clearCookieHeader({ secure: cookieSecure(req) }));
    if (!check.ok) {
      log.warn(`dashboard oauth state rejected (${check.reason}) from ${req.ip}`);
      return res.status(400).json({ error: 'Sign-in could not be verified. Please try again.' });
    }

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
    } catch (err) {
      log.error('dashboard auth callback failed', err);
      res.status(500).json({ error: 'Auth failed' });
    }
  });

  // Get current user
  app.get('/api/user', authMiddleware, async (req, res) => {
    res.json(req.user);
  });

  // Get guilds where user has Manage Guild + bot is present
  app.get('/api/guilds', authMiddleware, async (req, res) => {
    const guilds = await fetchGuilds(req.token);
    const manageable = guilds.filter(V.canManageGuild);
    const botGuilds = client.guilds.cache;
    const mutual = manageable.filter((g) => botGuilds.has(g.id));
    res.json(mutual.map((g) => ({ id: g.id, name: g.name, icon: g.icon })));
  });

  // Helper: verify the caller manages this guild (and the bot is in it). Responds + returns null on failure.
  async function verifyGuildAccess(req, res) {
    if (!V.isSnowflake(req.params.id)) { res.status(400).json({ error: 'Invalid guild id' }); return null; }
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) { res.status(404).json({ error: 'Guild not found' }); return null; }
    const guilds = await fetchGuilds(req.token);
    const hasAccess = guilds.some((g) => g.id === req.params.id && V.canManageGuild(g));
    if (!hasAccess) { res.status(403).json({ error: 'No access' }); return null; }
    return guild;
  }

  // Why a NEW level-reward role may not be saved by this dashboard user, or null. Rewards already stored are left
  // alone so unrelated edits are never blocked.
  async function levelRoleProblem(guild, userId, rewards) {
    const lv = require('../utils/xp');
    const known = new Set((store.getConfig(guild.id, 'level_roles') || []).map((e) => e.role || e.roleId));
    const fresh = rewards.filter((e) => !known.has(e.role));
    if (!fresh.length) return null;
    let member = null;
    try { member = guild.members?.cache?.get(userId) || await guild.members.fetch(userId); } catch { /* handled below */ }
    if (!member) return 'Could not check your roles in this server, so no new reward roles were saved.';
    for (const e of fresh) {
      const role = guild.roles?.cache?.get(e.role);
      const problem = lv.rewardRoleProblem(guild, role);
      if (problem) return problem;
      if (guild.ownerId !== member.id && role.position >= member.roles.highest.position) {
        return 'That role is at or above your highest role, so you cannot make it a level reward.';
      }
    }
    return null;
  }

  // Dashboard audit trail. Injectable; with an injected store (tests) and no injected audit it is off, so
  // test runs never write to the live database. Never throws: a failed audit write must not fail the change.
  const audit = deps.audit || (deps.store ? null : require('../database/dashaudit'));
  function track(req, action, detail) {
    if (!audit) return;
    try {
      audit.record({ guildId: req.params.id, userId: req.user.id, username: req.user.global_name || req.user.username, action, detail });
    } catch (err) { log.warn('dashboard audit write failed: ' + err.message); }
  }
  // Key names only; booleans keep their value (on/off is not sensitive). Never the other values.
  function describeKeys(values) {
    return Object.entries(values).map(([k, v]) => (typeof v === 'boolean' ? `${k}=${v}` : k)).join(', ');
  }

  function badRequest(res, msg) { return res.status(400).json({ error: msg }); }
  function badUserId(req, res) {
    if (V.isSnowflake(req.params.userId)) return false;
    badRequest(res, 'Invalid user id');
    return true;
  }
  function badRowId(value, res) {
    if (/^\d{1,15}$/.test(String(value))) return false;
    badRequest(res, 'Invalid id');
    return true;
  }

  // Get guild config
  app.get('/api/guilds/:id/config', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;

    const cfg = {};
    for (const key of V.ROUTE_KEYS.config) {
      cfg[key] = store.getConfig(req.params.id, key);
    }
    cfg.name = guild.name;
    cfg.icon = guild.iconURL();
    cfg.memberCount = guild.memberCount;

    res.json(cfg);
  });

  // Update guild config
  app.patch('/api/guilds/:id/config', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;

    const r = V.validateConfigPatch(req.body, 'config');
    if (!r.ok) return badRequest(res, r.error);
    for (const [key, value] of Object.entries(r.values)) {
      store.setConfig(req.params.id, key, value);
      // Two readers exist for the "log channel": messageDelete/Update/voice read log_channel, auditLog.js
      // reads logging_channel. Keep both in step so either dashboard field works.
      if (key === 'logging_channel') store.setConfig(req.params.id, 'log_channel', value);
      if (key === 'log_channel') store.setConfig(req.params.id, 'logging_channel', value);
    }
    track(req, 'config.update', describeKeys(r.values));

    res.json({ success: true });
  });

  // Guild stats
  app.get('/api/guilds/:id/stats', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;

    res.json({
      members: guild.memberCount,
      channels: guild.channels.cache.size,
      roles: guild.roles.cache.size,
      boosts: guild.premiumSubscriptionCount || 0,
    });
  });

  // AI chat endpoint for web assistant. Spends mofu's Groq key, so: caller must manage a server the bot
  // is in, history roles are forced to user/assistant (no client-supplied system prompt), and a per-user quota applies.
  app.post('/api/ai/chat', rateLimit(60000, 10), authMiddleware, userRateLimit(60000, 6, 'ai-min'), async (req, res) => {
    if (!(await managesAnyBotGuild(req.token))) return res.status(403).json({ error: 'No access' });
    if (!hit(`user:ai-day:${req.user.id}`, 86400000, 100)) return res.status(429).json({ error: 'Daily AI limit reached' });

    const v = V.validateAiChat(req.body);
    if (!v.ok) return badRequest(res, v.error);

    const { chatWithHistory } = deps.ai || require('../utils/ai');
    const response = await chatWithHistory(v.values.message, v.values.history, null, { guildId: 'web' });
    if (!response) return res.status(503).json({ error: 'AI unavailable', response: 'AI service is currently unavailable.' });
    res.json({ response });
  });

  // Get all warnings for guild
  app.get('/api/guilds/:id/warnings', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;

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
      log.error('dashboard route failed', err);
      res.status(500).json({ error: 'Failed to fetch warnings' });
    }
  });

  // Delete a warning
  app.delete('/api/guilds/:id/warnings/:wid', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;
    if (badRowId(req.params.wid, res)) return;

    try {
      const info = db.prepare('DELETE FROM warnings WHERE id = ? AND guild_id = ?').run(req.params.wid, req.params.id);
      if (info.changes === 0) return res.status(404).json({ error: 'Warning not found' });
      track(req, 'warning.delete', 'warning #' + req.params.wid);
      res.json({ success: true });
    } catch (err) {
      log.error('dashboard route failed', err);
      res.status(500).json({ error: 'Failed to delete warning' });
    }
  });

  // Get all notes for guild
  app.get('/api/guilds/:id/notes', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;

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
      log.error('dashboard route failed', err);
      res.status(500).json({ error: 'Failed to fetch notes' });
    }
  });

  // Delete a note
  app.delete('/api/guilds/:id/notes/:nid', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;
    if (badRowId(req.params.nid, res)) return;

    try {
      const info = db.prepare('DELETE FROM notes WHERE id = ? AND guild_id = ?').run(req.params.nid, req.params.id);
      if (info.changes === 0) return res.status(404).json({ error: 'Note not found' });
      track(req, 'note.delete', 'note #' + req.params.nid);
      res.json({ success: true });
    } catch (err) {
      log.error('dashboard route failed', err);
      res.status(500).json({ error: 'Failed to delete note' });
    }
  });

  // Mod stats — count of warns/bans/notes per moderator
  app.get('/api/guilds/:id/modstats', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;

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
      log.error('dashboard route failed', err);
      res.status(500).json({ error: 'Failed to fetch mod stats' });
    }
  });

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

    if (badUserId(req, res)) return;
    const r = V.validateXpPatch(req.body);
    if (!r.ok) return badRequest(res, r.error);

    const xpDb = deps.xpDb || require('../database/xp');
    const result = r.values.level !== undefined
      ? xpDb.setLevel(req.params.id, req.params.userId, r.values.level)
      : xpDb.setXp(req.params.id, req.params.userId, r.values.xp);
    track(req, 'xp.set', 'user ' + req.params.userId + ': ' + (r.values.level !== undefined ? 'level' : 'xp'));
    res.json(result);
  });

  // Get leveling config
  app.get('/api/guilds/:id/leveling-config', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;

    res.json({
      enabled: store.getConfig(req.params.id, 'leveling') !== false,
      levelup_channel: store.getConfig(req.params.id, 'levelup_channel'),
      xp_multiplier: store.getConfig(req.params.id, 'xp_multiplier') ?? 1,
      level_roles: store.getConfig(req.params.id, 'level_roles') || [],
      no_xp_channels: store.getConfig(req.params.id, 'no_xp_channels') || [],
      no_xp_roles: store.getConfig(req.params.id, 'no_xp_roles') || [],
    });
  });

  // Update leveling config
  app.patch('/api/guilds/:id/leveling-config', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;

    const r = V.validateConfigPatch(req.body, 'leveling');
    if (!r.ok) return badRequest(res, r.error);
    // Same rules as /levelrole: a new reward role must be one the bot can hand out AND one below the person
    // setting it. Without this, Manage Server alone could make an admin role a level reward and then level up.
    if (Array.isArray(r.values.level_roles)) {
      const problem = await levelRoleProblem(guild, req.user.id, r.values.level_roles);
      if (problem) return res.status(403).json({ error: problem });
    }
    for (const [key, value] of Object.entries(r.values)) store.setConfig(req.params.id, key, value);
    track(req, 'leveling.update', describeKeys(r.values));
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
      log.error('dashboard route failed', err);
      res.status(500).json({ error: 'Failed to fetch custom commands' });
    }
  });

  // Create custom command
  app.post('/api/guilds/:id/custom-commands', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;
    const r = V.validateCustomCommand(req.body);
    if (!r.ok) return badRequest(res, r.error);
    try {
      store.addCustomCommand(req.params.id, r.values.name, { response: r.values.response, embed: false });
      track(req, 'custom_command.create', 'command ' + r.values.name);
      res.json({ success: true });
    } catch (err) {
      log.error('dashboard route failed', err);
      res.status(500).json({ error: 'Failed to create custom command' });
    }
  });

  // Delete custom command
  app.delete('/api/guilds/:id/custom-commands/:name', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;
    try {
      const removed = store.removeCustomCommand(req.params.id, String(req.params.name).slice(0, 64));
      if (!removed) return res.status(404).json({ error: 'Command not found' });
      track(req, 'custom_command.delete', 'command ' + String(req.params.name).slice(0, 64));
      res.json({ success: true });
    } catch (err) {
      log.error('dashboard route failed', err);
      res.status(500).json({ error: 'Failed to delete custom command' });
    }
  });

  // Get automod config
  app.get('/api/guilds/:id/automod-config', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;
    const cfg = {};
    for (const key of V.ROUTE_KEYS.automod) {
      cfg[key] = store.getConfig(req.params.id, key);
    }
    res.json(cfg);
  });

  // Update automod config
  app.patch('/api/guilds/:id/automod-config', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;
    const r = V.validateConfigPatch(req.body, 'automod');
    if (!r.ok) return badRequest(res, r.error);
    for (const [key, value] of Object.entries(r.values)) store.setConfig(req.params.id, key, value);
    track(req, 'automod.update', describeKeys(r.values));
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

    if (badUserId(req, res)) return;
    const data = store.getBalance(req.params.id, req.params.userId);
    res.json(data);
  });

  // Admin adjust user's wallet/bank
  app.patch('/api/guilds/:id/economy/:userId', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;

    if (badUserId(req, res)) return;
    const r = V.validateEconomyPatch(req.body);
    if (!r.ok) return badRequest(res, r.error);
    const current = store.getBalance(req.params.id, req.params.userId);

    const newWallet = r.values.wallet ?? current.wallet;
    // never negative, and the bank cannot exceed the user's capacity (an already-over balance is left as is)
    const cap = store.getBankCapacity(req.params.id, req.params.userId);
    const newBank = Math.max(0, r.values.bank === undefined ? current.bank : Math.min(r.values.bank, Math.max(cap, current.bank)));

    // One write for both numbers, so wallet and bank can never be left out of step.
    store.setBalance(req.params.id, req.params.userId, newWallet, newBank);

    const final = store.getBalance(req.params.id, req.params.userId);
    track(req, 'economy.set', 'user ' + req.params.userId + ': ' + Object.keys(r.values).join(', '));
    res.json(final);
  });

  // Get shop items
  app.get('/api/guilds/:id/shop', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;

    const { ITEMS } = require('../utils/shopItems');
    const items = ITEMS;

    res.json(items);
  });

  // Dashboard activity log (changes made through the dashboard only). Same Manage Server check as the rest.
  app.get('/api/guilds/:id/audit', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 50);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    try {
      if (!audit) return res.json({ records: [], total: 0 });
      res.json({ records: audit.list(req.params.id, { limit, offset }), total: audit.count(req.params.id) });
    } catch (err) {
      log.error('dashboard route failed', err);
      res.status(500).json({ error: 'Failed to fetch activity' });
    }
  });

  // Per-server insights: aggregates only (daily counters, case counts, command counts). Manage Server, like the rest.
  // Injected in tests; with an injected store and no injected insights it is off so tests never touch the live db.
  const insights = deps.insights || (deps.store ? null : require('../database/insights'));
  app.get('/api/guilds/:id/insights', authMiddleware, async (req, res) => {
    const guild = await verifyGuildAccess(req, res);
    if (!guild) return;
    if (!insights) return res.status(503).json({ error: 'Insights unavailable' });
    const days = String(req.query.days) === '30' ? 30 : 7;
    try {
      const out = insights.query(req.params.id, { days });
      out.members = { total: guild.memberCount ?? null, activeChatters: insights.activeChatters(req.params.id, days) };
      if (out.members.activeChatters === null) out.notes.push('active chatters needs leveling: it counts members who earned xp, and this server has none yet.');
      res.json(out);
    } catch (err) {
      log.error('dashboard route failed', err);
      res.status(500).json({ error: 'Failed to fetch insights' });
    }
  });

  // Overview across every server the caller can manage AND the bot is in (same filter as /api/guilds). One
  // request, aggregates only. A null total/day means "not counted", never a zero standing in for missing data.
  app.get('/api/insights/overview', authMiddleware, async (req, res) => {
    if (!insights) return res.status(503).json({ error: 'Insights unavailable' });
    const days = String(req.query.days) === '30' ? 30 : 7;
    try {
      const guilds = (await fetchGuilds(req.token)).filter(V.canManageGuild).filter((g) => client.guilds.cache.has(g.id));
      const servers = [];
      for (const g of guilds) {
        const live = client.guilds.cache.get(g.id);
        const q = insights.query(g.id, { days });
        servers.push({
          guildId: g.id, name: g.name, icon: g.icon || null,
          members: live?.memberCount ?? null,
          counted: q.counters.available,
          messages: q.totals.messages, joins: q.totals.joins, leaves: q.totals.leaves, modActions: q.totals.modActions,
          previousMessages: q.previous.messages, previousModActions: q.previous.modActions,
          activeChatters: insights.activeChatters(g.id, days),
          series: q.series.messages.map((p) => p.count),
          _q: q,
        });
      }
      // null unless at least one server has the number; the previous period is null unless EVERY server that has a
      // current number also has a previous one (otherwise the delta would compare unlike sets).
      const sum = (key) => {
        const vals = servers.map((s) => s[key]).filter((v) => v !== null && v !== undefined);
        return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
      };
      const prevSum = (key, prevKey) => {
        const have = servers.filter((s) => s[key] !== null && s[key] !== undefined);
        if (!have.length || have.some((s) => s[prevKey] === null || s[prevKey] === undefined)) return null;
        return have.reduce((a, s) => a + s[prevKey], 0);
      };
      const sumSeries = (name) => {
        const first = servers[0]?._q.series[name];
        if (!first) return [];
        return first.map((p, i) => {
          const vals = servers.map((s) => s._q.series[name][i].count).filter((v) => v !== null);
          return { date: p.date, count: vals.length ? vals.reduce((a, b) => a + b, 0) : null };
        });
      };
      const range = servers[0]?._q.range || null;
      const sinces = servers.map((s) => s._q.counters.since).filter(Boolean).sort();
      const out = {
        range, servers: servers.length,
        counters: { available: servers.some((s) => s.counted), since: sinces[0] || null, serversCounted: servers.filter((s) => s.counted).length },
        totals: {
          members: sum('members'), messages: sum('messages'), joins: sum('joins'), leaves: sum('leaves'),
          modActions: servers.length ? sum('modActions') : null, activeChatters: sum('activeChatters'),
        },
        previous: {
          messages: prevSum('messages', 'previousMessages'),
          joins: null, leaves: null,
          modActions: prevSum('modActions', 'previousModActions'),
        },
        series: { messages: sumSeries('messages'), joins: sumSeries('joins'), leaves: sumSeries('leaves'), modActions: sumSeries('modActions') },
        perServer: servers.map(({ _q, ...s }) => s),
        notes: [],
      };
      const jp = servers.filter((s) => s.joins !== null);
      if (jp.length && jp.every((s) => s._q.previous.joins !== null)) {
        out.previous.joins = jp.reduce((a, s) => a + s._q.previous.joins, 0);
        out.previous.leaves = jp.reduce((a, s) => a + s._q.previous.leaves, 0);
      }
      if (!servers.length) out.notes.push('no servers found where you can manage the server and mofu is present.');
      else if (!out.counters.available) out.notes.push('message, join and leave counts have not started yet. they fill in as your servers are used.');
      else {
        if (out.counters.serversCounted < servers.length) out.notes.push(`${servers.length - out.counters.serversCounted} server(s) have no message counts yet and are left out of those totals.`);
        if (out.counters.since > out.range.from) out.notes.push(`counts start from ${out.counters.since}. earlier days show as not counted.`);
      }
      if (out.totals.activeChatters === null && servers.length) out.notes.push('active chatters needs leveling on at least one server.');
      res.json(out);
    } catch (err) {
      log.error('dashboard route failed', err);
      res.status(500).json({ error: 'Failed to fetch overview' });
    }
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

  // Consistent JSON errors; never leak stacks or internals.
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
    log.error('dashboard unhandled error', err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Internal error' });
  });

  return app;
}

function startDashboard(client) {
  const app = createApp(client);
  const port = config.dashboard.port;
  const server = app.listen(port, () => log.info(`API server running on port ${port}`));
  server.on('error', (err) => log.error(`API server failed (port ${port}); bot keeps running`, err));
  return app;
}

module.exports = { startDashboard, createApp };
