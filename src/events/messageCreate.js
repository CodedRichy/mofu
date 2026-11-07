const { Collection } = require('discord.js');
const config = require('../config');
const store = require('../database/store');
const log = require('../utils/logger');
const { track } = require('../utils/commandTracker');
const xpStore = require('../database/xp');
const { response, errorCard, refId, permissionDenied } = require('../utils/embed');
const { colors, TRIGGER_ALT } = require('../utils/constants');
const PrefixContext = require('../utils/prefixContext');
const modlog = require('../utils/modlog');
const { moderate, chatWithHistory } = require('../utils/ai');
const { parseMuteIntent, proposeMute, usageHint } = require('../ai/actions');
const { parseMusicIntent } = require('../utils/musicIntent');
const { parseTimezoneIntent } = require('../utils/tzIntent');
const { routeMessage } = require('../ai/router');
const automod = require('../utils/automod');

// The bot's name as a whole word: 'mofu' or the old name 'sonder' (TRIGGER_WORDS in src/utils/constants.js).
// Chat only: a stretched "mofuuu" still counts as saying the name. Actions use their own stricter parsers.
const TRIGGER_RE = new RegExp(`\\b(?:${TRIGGER_ALT.replace('mofu', 'mofu+')})\\b`, 'i');

// conversational replies ("yo mofu ...", "@mofu ..."): per-user cooldown so nobody can burn the AI quota
const CHAT_COOLDOWN_MS = 4000;
const chatCooldown = new Map();
setInterval(() => {
  const cutoff = Date.now() - CHAT_COOLDOWN_MS;
  for (const [id, t] of chatCooldown) if (t < cutoff) chatCooldown.delete(id);
}, 60000).unref();

// What mofu knows when it answers a plain message: who is talking, who they mentioned (name, join date,
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

// Who can invoke mofu in plain text: administrators always; otherwise members holding a role set with
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
const { SPAM_THRESHOLD, SPAM_WINDOW_MS: SPAM_WINDOW, SPAM_TIMEOUT_MS } = require('../utils/automodRules');

// Drop spam-tracker entries whose newest timestamp is outside the window,
// otherwise every user who ever spoke in an antispam guild stays in memory.
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of spamTracker) {
    if (now - timestamps[timestamps.length - 1] >= SPAM_WINDOW) spamTracker.delete(key);
  }
}, 60000).unref();

// The prefix command path: parse, permission check, cooldown, PrefixContext validation, execute. Typed commands
// and commands routed from chat (src/ai/router.js rewrites message.content first) both come through here.
async function runPrefixCommand(message, prefix) {
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
      await message.reply({ embeds: [permissionDenied(message.client, command)] });
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

    // Warm the caches for mentioned users and raw 17-20 digit ids so getUser/getMember resolve.
    // Deduped and fetched in parallel; failures are tolerated (the id then fails validation in PrefixContext).
    const wanted = new Set();
    for (const m of message.content.matchAll(/<@!?(\d{17,20})>/g)) wanted.add(m[1]);
    for (const a of args) if (/^\d{17,20}$/.test(a)) wanted.add(a);
    const uncached = [...wanted].filter((id) => !message.guild.members.cache.has(id));
    if (uncached.length) {
      await Promise.all(uncached.map(async (id) => {
        try { await message.guild.members.fetch(id); } catch {
          if (!message.client.users.cache.has(id)) await message.client.users.fetch(id).catch(() => {});
        }
      }));
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

    // A command with subcommands that was given none (or a wrong one) falls through without replying, which
    // looks like the bot ignoring you (";warn @user spam", ";bank"). Say what it expects instead of staying silent.
    if (!ctx.replied && !ctx.deferred) {
      let subs = [];
      try { subs = (command.data.toJSON().options || []).filter((o) => o.type === 1 || o.type === 2); } catch { /* not a builder */ }
      if (subs.length) {
        const names = subs.map((s) => s.name).join(' | ');
        await message.reply({
          embeds: [response({ client: message.client, description: `Usage: \`${prefix}${commandName} <${names}>\``, color: colors.muted })],
          allowedMentions: { parse: [], repliedUser: false },
        }).catch(() => {});
      }
    }
    track(commandName, { userId: message.author.id, guildId: message.guildId, type: 'prefix', feedback: ctx.failure ? 'errored' : 'ok', error: ctx.failure || null });
  } catch (err) {
    track(commandName, { userId: message.author.id, guildId: message.guildId, type: 'prefix', feedback: 'errored', error: err.message });
    const ref = refId();
    log.error(`Prefix command ${commandName} failed [ref ${ref}]:`, err.message);
    await message.reply({ embeds: [errorCard({ client: message.client, title: 'That did not work', fix: 'Try again in a moment. If it keeps happening, tell the server admins and quote the ref below.', ref })] }).catch(() => {});
  }
}

module.exports = {
  name: 'messageCreate',
  runPrefixCommand,
  canInvokeAi,
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

    // --- scamshield hook (src/utils/scamshield.js): no AI, off by default, never throws ---
    if (await require('../utils/scamshield').inspectMessage(message)) return;
    // --- end scamshield hook ---

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
          const NEW_ACCOUNT_MS = 7 * 86400000;
          if (accountAge < NEW_ACCOUNT_MS) {
            alertCh.send({ embeds: [response({ client: message.client, description: `**Nightwatch** New account (<${NEW_ACCOUNT_MS / 86400000}d) active: ${message.author} in ${message.channel}\n> ${message.content.slice(0, 200)}`, color: colors.warning })] }).catch(() => {});
          }

          if (/https?:\/\/[^\s]+/i.test(message.content)) {
            alertCh.send({ embeds: [response({ client: message.client, description: `**Nightwatch** Link posted by ${message.author} in ${message.channel}\n> ${message.content.slice(0, 200)}`, color: colors.info })] }).catch(() => {});
          }
        }
      }
    }

    // Antilink + word filter (shared with messageUpdate so edits cannot dodge them)
    if (automod.enforce(message)) return;

    // Anti-spam — auto-timeout if 5+ messages in 3 seconds
    // An /automod spam rule turns detection on too and replaces the fixed 1-minute mute with its ladder.
    const spamRule = automod.spamRule(message.guild.id);
    const antispam = store.getConfig(message.guild.id, 'antispam') || spamRule;
    if (antispam && !message.member.permissions.has('ManageMessages')) {
      const key = `${message.guild.id}:${message.author.id}`;
      const now = Date.now();
      const timestamps = spamTracker.get(key) || [];
      const recent = timestamps.filter((t) => now - t < SPAM_WINDOW);
      recent.push(now);
      spamTracker.set(key, recent);

      if (recent.length >= SPAM_THRESHOLD) {
        spamTracker.delete(key);
        if (spamRule) { await automod.enforceSpam(message, SPAM_THRESHOLD); return; }
        const muted = await message.member.timeout(SPAM_TIMEOUT_MS, 'Anti-spam: message velocity exceeded').then(() => true, () => false);
        const msgs = await message.channel.messages.fetch({ limit: SPAM_THRESHOLD }).catch(() => null);
        const userMsgs = msgs ? msgs.filter((m) => m.author.id === message.author.id) : null;
        if (userMsgs?.size) await message.channel.bulkDelete(userMsgs).catch(() => {});
        const mins = SPAM_TIMEOUT_MS / 60000;
        const notice = muted
          ? `${message.author} muted for **${mins} minute${mins === 1 ? '' : 's'}**: spam detected.`
          : `Spam detected, but I could not time out ${message.author} (check my Moderate Members permission and role position).`;
        message.channel.send({ embeds: [response({ client: message.client, description: notice, color: colors.error })] })
          .then((m) => setTimeout(() => m.delete().catch(() => {}), 5000)).catch(() => {});
        await modlog.send(message.guild, {
          action: muted ? 'Auto-Mute (Spam)' : 'Spam Detected (mute failed)',
          target: message.author,
          moderator: message.client.user,
          reason: `Sent ${SPAM_THRESHOLD}+ messages in ${SPAM_WINDOW / 1000}s`,
        });
        return;
      }
    }

    // AI automod — async content moderation
    const aiMod = store.getConfig(message.guild.id, 'ai_automod');
    if (aiMod && !message.member.permissions.has('ManageMessages') && message.content.length > 10) {
      moderate(message.content, { guildId: message.guild.id }).then((result) => {
        if (result?.flagged) {
          automod.markBotDeleted(message.id);
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

    // XP gain (no-XP lists, multipliers, level rewards, announcement: src/utils/xp.js). Not awaited; never throws.
    require('../utils/xp').handleMessageXp(message, { min: XP_MIN, max: XP_MAX, cooldown: XP_COOLDOWN });

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

    // Conversational reply: any message containing the word "mofu" or "sonder" (or @mentioning the bot),
    // from someone allowed to invoke it. Plain chat only: no tools, no actions, no pings.
    // "mofu play <song>" / "mofu skip" etc. are music commands, not chat: rewrite to the prefix form
    // and let the normal command path run them (same permission checks, same output).
    if (!message.content.startsWith(prefix)) {
      // Strict matcher (src/utils/musicIntent.js) plus the same eligibility as the AI path, so ordinary
      // sentences ("mofu stop being weird") and random members never trigger playback commands.
      const intent = parseMusicIntent(message.content, message.client.user.id)
        || parseTimezoneIntent(message.content, message.client.user.id);
      if (intent && canInvokeAi(message)) {
        message.content = `${prefix}${intent.verb} ${intent.args}`.trim();
      }
    }

    if (!message.content.startsWith(prefix)) {
      const botId = message.client.user.id;
      const mentionRe = new RegExp(`<@!?${botId}>`, 'g');
      let named = TRIGGER_RE.test(message.content) || mentionRe.test(message.content);
      // Replying to one of the bot's own messages is talking to it, no name needed. Only chat is eligible
      // (a reply never becomes a mute/music action: those parsers still need the name in the text).
      if (!named && message.reference?.messageId && canInvokeAi(message)) {
        const ref = message.channel.messages.cache.get(message.reference.messageId)
          || await message.fetchReference().catch(() => null);
        // Plain-text bot messages only (its chat replies), not command embeds or confirm cards.
        named = ref?.author?.id === botId && !!ref.content && !ref.embeds?.length && !ref.components?.length;
      }

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

        // any other command said in plain words ("mofu what's my balance", "mofu ban @x spam"): the model picks
        // from real commands, code checks it, risky ones need a confirm card. false = not a command, so chat.
        const routed = await routeMessage(message, { prefix, runPrefix: (m) => runPrefixCommand(m, prefix), canInvokeAi })
          .catch((err) => { log.warn(`AI route failed: ${err.message}`); return false; });
        if (routed) return;

        message.channel.sendTyping().catch(() => {});
        const { text, history, context } = await buildChatContext(message, botId);
        const reply = await chatWithHistory(text, history, context, { guildId: message.guild.id });
        if (reply) {
          await message.reply({ content: reply.slice(0, 1900), allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
        } else {
          log.warn('Conversational reply failed: no response from AI provider');
        }
      }
      return;
    }

    await runPrefixCommand(message, prefix);
  },
};
