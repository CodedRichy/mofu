const { Collection } = require('discord.js');
const config = require('../config');
const store = require('../database/store');
const log = require('../utils/logger');
const { track, promptFeedback } = require('../utils/commandTracker');
const xpStore = require('../database/xp');
const { response } = require('../utils/embed');
const { colors } = require('../utils/constants');
const PrefixContext = require('../utils/prefixContext');
const modlog = require('../utils/modlog');
const { moderate } = require('../utils/ai');

const cooldowns = new Collection();
const spamTracker = new Map();

const XP_MIN = 15;
const XP_MAX = 25;
const stickyLocks = new Set();
const XP_COOLDOWN = 60000;
const SPAM_THRESHOLD = 5;
const SPAM_WINDOW = 3000;

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
    if (!message.content.startsWith(prefix)) return;

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

      const mentions = message.content.match(/<@!?(\d+)>/g) || [];
      for (const m of mentions) {
        const id = m.replace(/[<@!>]/g, '');
        if (!message.guild.members.cache.has(id)) {
          await message.guild.members.fetch(id).catch(() => {});
        }
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

      const ctx = new PrefixContext(message, args, command);
      if (ctx._missingArgs.length) {
        const usage = ctx._missingArgs.map((a) => `\`<${a}>\``).join(', ');
        await message.reply({ embeds: [response({ client: message.client, description: `Missing required argument: ${usage}`, color: colors.error })] });
        return;
      }
      await command.execute(ctx);
      promptFeedback(ctx, commandName, 'prefix');
    } catch (err) {
      track(commandName, { userId: message.author.id, guildId: message.guildId, type: 'prefix', feedback: 'errored', error: err.message });
      log.error(`Prefix command ${commandName} failed:`, err.message);
      await message.reply({ content: 'Something went wrong.' }).catch(() => {});
    }
  },
};
