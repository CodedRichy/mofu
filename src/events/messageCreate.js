const { Collection } = require('discord.js');
const config = require('../config');
const store = require('../database/store');
const log = require('../utils/logger');
const { track } = require('../utils/commandTracker');
const xpStore = require('../database/xp');
const { response } = require('../utils/embed');
const { colors } = require('../utils/constants');
const PrefixContext = require('../utils/prefixContext');
const modlog = require('../utils/modlog');
const { moderate, chatWithHistory } = require('../utils/ai');
const { parseMuteIntent, proposeMute, usageHint } = require('../ai/actions');

// conversational replies ("yo sonder ...", "@sonder ..."): per-user cooldown so nobody can burn the AI quota
const CHAT_COOLDOWN_MS = 4000;
const chatCooldown = new Map();
setInterval(() => {
  const cutoff = Date.now() - CHAT_COOLDOWN_MS;
  for (const [id, t] of chatCooldown) if (t < cutoff) chatCooldown.delete(id);
}, 60000).unref();

// What Sonder knows when it answers a plain message: who is talking, who they mentioned (name, join date,
// top roles: facts Discord already shows everyone), the time, and the last ~20 minutes of this channel.
// Plain chat only. This text goes to the AI provider, so it is limited to 10 messages.
async function buildChatContext(message, botId) {
  const guild = message.guild;
  const nameOf = (m) => m.member?.displayName || m.author?.username || 'someone';
  const speaker = message.member?.displayName || message.author.username;

  const lines = [
    `server: ${guild.name} | channel: #${message.channel.name}`,
    `now: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    `talking to you: ${speaker}`,
  ];
  if (guild.description) lines.push(`about this server: ${guild.description}`);
  if (message.channel.topic) lines.push(`this channel's topic: ${message.channel.topic}`);
  const notes = store.getConfig(guild.id, 'ai_notes');
  if (Array.isArray(notes) && notes.length) lines.push(`facts the admins told you about this server (trust these):\n${notes.slice(0, 20).map((n) => `- ${String(n).slice(0, 200)}`).join('\n')}`);
  for (const m of [...message.mentions.members.values()].filter((x) => x.id !== botId).slice(0, 5)) {
    const roles = m.roles.cache.filter((r) => r.id !== guild.id).sort((a, b) => b.position - a.position).first(4).map((r) => r.name);
    lines.push(`mentioned: ${m.displayName} (@${m.user.username}${m.user.bot ? ', a bot' : ''}), joined ${m.joinedAt ? m.joinedAt.toISOString().slice(0, 10) : 'unknown'}${roles.length ? `, roles: ${roles.join(', ')}` : ''}${m.isCommunicationDisabled() ? `, currently muted (timed out until ${m.communicationDisabledUntil.toISOString().slice(0, 16).replace('T', ' ')} UTC)` : ', not muted'}`);
  }

  let history = [];
  try {
    const recent = await message.channel.messages.fetch({ limit: 10, before: message.id });
    history = [...recent.values()].reverse()
      .filter((m) => Date.now() - m.createdTimestamp < 20 * 60 * 1000 && m.content)
      .map((m) => (m.author.id === botId
        ? { role: 'assistant', content: m.cleanContent.slice(0, 300) }
        : { role: 'user', content: `${nameOf(m)}: ${m.cleanContent.slice(0, 300)}` }));
  } catch {}

  return { text: `${speaker}: ${message.cleanContent.slice(0, 1500)}`, history, context: lines.join('\n') };
}

// Who can invoke Sonder in plain text: administrators always; otherwise members holding a role set with
// /airoles; with no roles configured, staff who can Manage Messages. Anyone else gets no reply at all.
function canInvokeAi(message) {
  const member = message.member;
  if (!member) return false;
  if (member.permissions.has('Administrator')) return true;
  const allowed = store.getConfig(message.guild.id, 'ai_roles');
  if (Array.isArray(allowed) && allowed.length > 0) return member.roles.cache.some((r) => allowed.includes(r.id));
  return member.permissions.has('ManageMessages');
}

const cooldowns = new Collection();
const spamTracker = new Map();

const XP_MIN = 15;
const XP_MAX = 25;
const stickyLocks = new Set();
const XP_COOLDOWN = 60000;
const SPAM_THRESHOLD = 5;
const SPAM_WINDOW = 3000;

// Drop spam-tracker entries whose newest timestamp is outside the window,
// otherwise every user who ever spoke in an antispam guild stays in memory.
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of spamTracker) {
    if (now - timestamps[timestamps.length - 1] >= SPAM_WINDOW) spamTracker.delete(key);
  }
}, 60000).unref();

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    // Bump reminder — detect Disboard bump confirmation
    if (message.author.id === '302050872383242240' && message.embeds[0]?.description?.includes('Bump done')) {
      const bumpChannel = store.getConfig(message.guild.id, 'bump_channel');
      if (bumpChannel) {
        setTimeout(() => {
          const ch = message.guild.channels.cache.get(bumpChannel);
          if (ch) ch.send({ embeds: [response({ client: message.client, description: 'Time to bump! Use `/bump` to bump the server.', color: colors.primary })] }).catch(() => {});
        }, 7200000);
      }
    }

    if (message.author.bot || !message.guild) return;

    // Nightwatch — enhanced monitoring during off-hours
    const nightwatch = store.getConfig(message.guild.id, 'nightwatch');
    if (nightwatch?.enabled) {
      const currentHour = new Date().getHours();
      const isActive = nightwatch.start > nightwatch.end
        ? currentHour >= nightwatch.start || currentHour < nightwatch.end
        : currentHour >= nightwatch.start && currentHour < nightwatch.end;

      if (isActive) {
        const alertCh = message.guild.channels.cache.get(nightwatch.alertChannel);
        if (alertCh) {
          const accountAge = Date.now() - message.author.createdTimestamp;
          if (accountAge < 7 * 86400000) {
            alertCh.send({ embeds: [response({ client: message.client, description: `**Nightwatch** New account (<7d) active: ${message.author} in ${message.channel}\n> ${message.content.slice(0, 200)}`, color: colors.warning })] }).catch(() => {});
          }

          if (/https?:\/\/[^\s]+/i.test(message.content)) {
            alertCh.send({ embeds: [response({ client: message.client, description: `**Nightwatch** Link posted by ${message.author} in ${message.channel}\n> ${message.content.slice(0, 200)}`, color: colors.info })] }).catch(() => {});
          }
        }
      }
    }

    // Antilink
    const antilink = store.getConfig(message.guild.id, 'antilink');
    if (antilink && !message.member.permissions.has('ManageMessages')) {
      const urlRegex = /https?:\/\/[^\s]+/i;
      if (urlRegex.test(message.content)) {
        const whitelist = store.getConfig(message.guild.id, 'antilink_whitelist') || [];
        const isWhitelisted = whitelist.some((d) => message.content.toLowerCase().includes(d));
        if (!isWhitelisted) {
          message.delete().catch(() => {});
          message.channel.send({ embeds: [response({ client: message.client, description: `${message.author}, links are not allowed here.`, color: colors.error })] })
            .then((m) => setTimeout(() => m.delete().catch(() => {}), 5000)).catch(() => {});
          return;
        }
      }
    }

    // Anti-spam — auto-timeout if 5+ messages in 3 seconds
    const antispam = store.getConfig(message.guild.id, 'antispam');
    if (antispam && !message.member.permissions.has('ManageMessages')) {
      const key = `${message.guild.id}:${message.author.id}`;
      const now = Date.now();
      const timestamps = spamTracker.get(key) || [];
      const recent = timestamps.filter((t) => now - t < SPAM_WINDOW);
      recent.push(now);
      spamTracker.set(key, recent);

      if (recent.length >= SPAM_THRESHOLD) {
        spamTracker.delete(key);
        await message.member.timeout(60000, 'Anti-spam: message velocity exceeded').catch(() => {});
        const msgs = await message.channel.messages.fetch({ limit: SPAM_THRESHOLD });
        const userMsgs = msgs.filter((m) => m.author.id === message.author.id);
        await message.channel.bulkDelete(userMsgs).catch(() => {});
        message.channel.send({ embeds: [response({ client: message.client, description: `${message.author} muted for **1 minute** — spam detected.`, color: colors.error })] })
          .then((m) => setTimeout(() => m.delete().catch(() => {}), 5000)).catch(() => {});
        await modlog.send(message.guild, {
          action: 'Auto-Mute (Spam)',
          target: message.author,
          moderator: message.client.user,
          reason: `Sent ${SPAM_THRESHOLD}+ messages in ${SPAM_WINDOW / 1000}s`,
        });
        return;
      }
    }

    // Word filter
    const wordFilter = store.getConfig(message.guild.id, 'word_filter');
    if (wordFilter?.length && !message.member.permissions.has('ManageMessages')) {
      const lower = message.content.toLowerCase();
      const matched = wordFilter.find((w) => lower.includes(w.toLowerCase()));
      if (matched) {
        message.delete().catch(() => {});
        message.channel.send({ embeds: [response({ client: message.client, description: `${message.author}, that word is not allowed here.`, color: colors.error })] })
          .then((m) => setTimeout(() => m.delete().catch(() => {}), 5000)).catch(() => {});
        return;
      }
    }

    // AI automod — async content moderation
    const aiMod = store.getConfig(message.guild.id, 'ai_automod');
    if (aiMod && !message.member.permissions.has('ManageMessages') && message.content.length > 10) {
      moderate(message.content).then((result) => {
        if (result?.flagged) {
          message.delete().catch(() => {});
          message.channel.send({ embeds: [response({ client: message.client, description: `${message.author}, your message was removed by AI moderation.`, color: colors.error })] })
            .then((m) => setTimeout(() => m.delete().catch(() => {}), 5000)).catch(() => {});
          modlog.send(message.guild, {
            action: 'Auto-Delete (AI)',
            target: message.author,
            moderator: message.client.user,
            reason: result.reason || 'Flagged by AI moderation',
          });
        }
      }).catch(() => {});
    }

    // Counter
    const counterChannel = store.getConfig(message.guild.id, 'counter_channel');
    if (counterChannel && message.channel.id === counterChannel) {
      const currentCount = store.getConfig(message.guild.id, 'counter_count') || 0;
      const lastUser = store.getConfig(message.guild.id, 'counter_last_user');
      const num = parseInt(message.content.trim());

      if (isNaN(num) || num !== currentCount + 1 || message.author.id === lastUser) {
        message.react('❌').catch(() => {});
      } else {
        store.setConfig(message.guild.id, 'counter_count', num);
        store.setConfig(message.guild.id, 'counter_last_user', message.author.id);
        message.react('✅').catch(() => {});
      }
      return;
    }

    // Forcenick enforcement
    const forcedNick = store.getConfig(message.guild.id, `forcenick_${message.author.id}`);
    if (forcedNick && message.member.nickname !== forcedNick && message.member.manageable) {
      message.member.setNickname(forcedNick).catch(() => {});
    }

    // XP gain
    const leveling = store.getConfig(message.guild.id, 'leveling') ?? true;
    if (leveling && xpStore.canEarnXp(message.guild.id, message.author.id, XP_COOLDOWN)) {
      const amount = Math.floor(Math.random() * (XP_MAX - XP_MIN + 1)) + XP_MIN;
      const result = xpStore.addXp(message.guild.id, message.author.id, amount);

      if (result.leveledUp) {
        const channelId = store.getConfig(message.guild.id, 'levelup_channel');
        const target = channelId ? message.guild.channels.cache.get(channelId) : message.channel;

        if (target) {
          const embed = response({
            client: message.client,
            description: `**${message.author.tag}** reached level **${result.level}**`,
            color: colors.primary,
          });
          target.send({ embeds: [embed] }).catch(() => {});
        }
      }
    }

    // Autoresponder
    const responders = store.getConfig(message.guild.id, 'autoresponders') || {};
    const lower = message.content.toLowerCase();
    for (const [trigger, resp] of Object.entries(responders)) {
      if (lower.includes(trigger)) {
        message.reply(resp).catch(() => {});
        break;
      }
    }

    // Sticky message
    const sticky = store.getConfig(message.guild.id, `sticky_${message.channel.id}`);
    if (sticky && !stickyLocks.has(message.channel.id)) {
      stickyLocks.add(message.channel.id);
      try {
        const lastStickyId = store.getConfig(message.guild.id, `sticky_msg_${message.channel.id}`);
        if (lastStickyId) {
          const old = await message.channel.messages.fetch(lastStickyId).catch(() => null);
          if (old) await old.delete().catch(() => {});
        }
        const sent = await message.channel.send({ embeds: [response({ client: message.client, description: `📌 ${sticky}`, color: colors.muted })] }).catch(() => null);
        if (sent) store.setConfig(message.guild.id, `sticky_msg_${message.channel.id}`, sent.id);
      } finally {
        stickyLocks.delete(message.channel.id);
      }
    }

    // AFK — clear if user speaks
    const userAfk = store.getConfig(message.guild.id, `afk_${message.author.id}`);
    if (userAfk) {
      store.setConfig(message.guild.id, `afk_${message.author.id}`, null);
      const ago = Math.floor((Date.now() - userAfk.since) / 60000);
      message.reply({ embeds: [response({ client: message.client, description: `Welcome back! You were AFK for **${ago || '< 1'}m**`, color: colors.success })] }).catch(() => {});
    }

    // AFK — notify if mentioned user is AFK
    for (const mentioned of message.mentions.users.values()) {
      const afk = store.getConfig(message.guild.id, `afk_${mentioned.id}`);
      if (afk) {
        message.reply({ embeds: [response({ client: message.client, description: `${mentioned.tag} is AFK: **${afk.reason}** (<t:${Math.floor(afk.since / 1000)}:R>)`, color: colors.muted })] }).catch(() => {});
      }
    }

    // Prefix commands
    const prefix = store.getConfig(message.guild.id, 'prefix') || config.discord.defaultPrefix;

    // Conversational reply: any message containing the word "sonder" (or @mentioning the bot),
    // from someone allowed to invoke it. Plain chat only: no tools, no actions, no pings.
    // "sonder play <song>" / "sonder skip" etc. are music commands, not chat: rewrite to the prefix form
    // and let the normal command path run them (same permission checks, same output).
    if (!message.content.startsWith(prefix)) {
      const m = message.content.match(/^\s*(?:(?:hey|yo)\s+)?(?:sonder|<@!?\d+>)[,:]?\s+(play|skip|pause|resume|stop|queue|shuffle|loop|volume|nowplaying)\b\s*(.*)$/is);
      if (m && (!/^<@!?\d+>/.test(message.content.trim()) || new RegExp(`^\\s*<@!?${message.client.user.id}>`).test(message.content))) {
        const verb = m[1].toLowerCase() === 'resume' ? 'pause' : m[1].toLowerCase();
        message.content = `${prefix}${verb} ${m[2]}`.trim();
      }
    }

    if (!message.content.startsWith(prefix)) {
      const botId = message.client.user.id;
      const mentionRe = new RegExp(`<@!?${botId}>`, 'g');
      const named = /\bsonder\b/i.test(message.content) || mentionRe.test(message.content);

      if (named && canInvokeAi(message)) {
        const last = chatCooldown.get(message.author.id) || 0;
        if (Date.now() - last < CHAT_COOLDOWN_MS) return;
        chatCooldown.set(message.author.id, Date.now());

        // actions first: a parsed request goes through confirmation, everything else is chat
        const intent = parseMuteIntent(message.content, botId);
        if (intent) {
          await proposeMute(message, intent);
          return;
        }
        const hint = usageHint(message.content, botId);
        if (hint) {
          await message.reply({ content: hint, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
          return;
        }

        message.channel.sendTyping().catch(() => {});
        const { text, history, context } = await buildChatContext(message, botId);
        const reply = await chatWithHistory(text, history, context);
        if (reply) {
          await message.reply({ content: reply.slice(0, 1900), allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
        } else {
          log.warn('Conversational reply failed: no response from AI provider');
        }
      }
      return;
    }

    const args = message.content.slice(prefix.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();

    const command = message.client.commands.get(commandName) || message.client.aliases.get(commandName);
    if (!command) {
      const custom = store.getCustomCommand(message.guild.id, commandName);
      if (custom) {
        const text = custom.response
          .replace(/{user}/gi, message.author.toString())
          .replace(/{user\.tag}/gi, message.author.tag)
          .replace(/{server}/gi, message.guild.name)
          .replace(/{membercount}/gi, message.guild.memberCount.toString());
        if (custom.embed) {
          const embed = response({ client: message.client, description: text, color: colors.primary });
          await message.reply({ embeds: [embed] }).catch(() => {});
        } else {
          await message.reply(text).catch(() => {});
        }
      }
      return;
    }

    try {
      const requiredPerms = command.data.default_member_permissions;
      if (requiredPerms && !message.member.permissions.has(BigInt(requiredPerms))) {
        await message.reply({ embeds: [response({ client: message.client, description: 'You lack permission to use this command.', color: colors.error })] });
        return;
      }

      const cooldownAmount = (command.cooldown || 3) * 1000;
      if (!cooldowns.has(command.data.name)) cooldowns.set(command.data.name, new Collection());
      const timestamps = cooldowns.get(command.data.name);
      const now = Date.now();

      if (timestamps.has(message.author.id)) {
        const expiry = timestamps.get(message.author.id) + cooldownAmount;
        if (now < expiry) {
          const remaining = ((expiry - now) / 1000).toFixed(1);
          await message.reply({ embeds: [response({ client: message.client, description: `Wait **${remaining}s** before using this again.`, color: colors.error })] });
          return;
        }
      }
      timestamps.set(message.author.id, now);
      setTimeout(() => timestamps.delete(message.author.id), cooldownAmount);

      // Warm the member cache for mentioned users so getUser/getMember resolve.
      // Deduped and fetched in parallel; skipped entirely when on cooldown.
      const uncached = new Set();
      for (const m of message.content.matchAll(/<@!?(\d+)>/g)) {
        if (!message.guild.members.cache.has(m[1])) uncached.add(m[1]);
      }
      if (uncached.size) {
        await Promise.all([...uncached].map((id) => message.guild.members.fetch(id).catch(() => {})));
      }

      const ctx = new PrefixContext(message, args, command);
      if (ctx._missingArgs.length) {
        const usage = ctx._missingArgs.map((a) => `\`<${a}>\``).join(', ');
        await message.reply({ embeds: [response({ client: message.client, description: `Missing required argument: ${usage}`, color: colors.error })] });
        return;
      }
      if (ctx._invalid.length) {
        await message.reply({ embeds: [response({ client: message.client, description: ctx._invalid.join('\n'), color: colors.error })], allowedMentions: { parse: [], repliedUser: false } });
        return;
      }
      await command.execute(ctx);
      track(commandName, { userId: message.author.id, guildId: message.guildId, type: 'prefix', feedback: ctx.failure ? 'errored' : 'ok', error: ctx.failure || null });
    } catch (err) {
      track(commandName, { userId: message.author.id, guildId: message.guildId, type: 'prefix', feedback: 'errored', error: err.message });
      log.error(`Prefix command ${commandName} failed:`, err.message);
      await message.reply({ content: 'Something went wrong.' }).catch(() => {});
    }
  },
};
