const { AuditLogEvent } = require('discord.js');
const store = require('../database/store');
const antinuke = require('../database/antinuke');
const { punishExecutor, stepLines } = require('../utils/auditEntry');
const { base, response, footer } = require('../utils/embed');
const { colors } = require('../utils/constants');
const log = require('../utils/logger');

function getLogChannel(guild, client) {
  // The dashboard and /logging historically used different keys; honour either so the setting always works.
  const channelId = store.getConfig(guild.id, 'logging_channel') || store.getConfig(guild.id, 'log_channel');
  if (!channelId) return null;
  return guild.channels.cache.get(channelId) || null;
}

module.exports = [
  {
    name: 'channelCreate',
    async execute(channel) {
      const logCh = getLogChannel(channel.guild, channel.client);
      if (!logCh) return;
      const entry = await fetchAuditEntry(channel.guild, AuditLogEvent.ChannelCreate);
      const embed = base(channel.client, colors.primary)
        .setAuthor({ name: 'Channel Created' })
        .setDescription(`**#${channel.name}** (${channel.type === 0 ? 'Text' : 'Voice'})\n**By** ${entry?.executor || 'Unknown'}`)
        .setFooter(footer(channel.client, `ID: ${channel.id}`));
      logCh.send({ embeds: [embed] }).catch(() => {});
    },
  },
  {
    name: 'channelDelete',
    async execute(channel) {
      const logCh = getLogChannel(channel.guild, channel.client);
      if (!logCh) return;
      const entry = await fetchAuditEntry(channel.guild, AuditLogEvent.ChannelDelete);
      const embed = base(channel.client, colors.primary)
        .setAuthor({ name: 'Channel Deleted' })
        .setDescription(`**#${channel.name}**\n**By** ${entry?.executor || 'Unknown'}`)
        .setFooter(footer(channel.client, `ID: ${channel.id}`));
      logCh.send({ embeds: [embed] }).catch(() => {});
    },
  },
  {
    name: 'guildBanAdd',
    async execute(ban) {
      const logCh = getLogChannel(ban.guild, ban.client);
      if (!logCh) return;
      const entry = await fetchAuditEntry(ban.guild, AuditLogEvent.MemberBanAdd);
      const embed = base(ban.client, colors.error)
        .setAuthor({ name: 'Member Banned', iconURL: ban.user.displayAvatarURL() })
        .setDescription(`**${ban.user.tag}**\n**By** ${entry?.executor || 'Unknown'}\n**Reason** ${entry?.reason || 'None'}`)
        .setFooter(footer(ban.client, `ID: ${ban.user.id}`));
      logCh.send({ embeds: [embed] }).catch(() => {});
    },
  },
  {
    name: 'guildBanRemove',
    async execute(ban) {
      const logCh = getLogChannel(ban.guild, ban.client);
      if (!logCh) return;
      const entry = await fetchAuditEntry(ban.guild, AuditLogEvent.MemberBanRemove);
      const embed = base(ban.client, colors.primary)
        .setAuthor({ name: 'Member Unbanned', iconURL: ban.user.displayAvatarURL() })
        .setDescription(`**${ban.user.tag}**\n**By** ${entry?.executor || 'Unknown'}`)
        .setFooter(footer(ban.client, `ID: ${ban.user.id}`));
      logCh.send({ embeds: [embed] }).catch(() => {});
    },
  },
  {
    name: 'guildMemberUpdate',
    async execute(oldMember, newMember) {
      const logCh = getLogChannel(newMember.guild, newMember.client);
      if (!logCh) return;

      // Role changes
      const addedRoles = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
      const removedRoles = oldMember.roles.cache.filter((r) => !newMember.roles.cache.has(r.id));

      if (addedRoles.size || removedRoles.size) {
        const lines = [];
        if (addedRoles.size) lines.push(`**Added** ${addedRoles.map((r) => r.toString()).join(', ')}`);
        if (removedRoles.size) lines.push(`**Removed** ${removedRoles.map((r) => r.toString()).join(', ')}`);
        const embed = base(newMember.client, colors.primary)
          .setAuthor({ name: 'Roles Updated', iconURL: newMember.user.displayAvatarURL() })
          .setDescription(`**${newMember.user.tag}**\n${lines.join('\n')}`)
          .setFooter(footer(newMember.client, `ID: ${newMember.id}`));
        logCh.send({ embeds: [embed] }).catch(() => {});
      }

      // Nickname change
      if (oldMember.nickname !== newMember.nickname) {
        const embed = base(newMember.client, colors.primary)
          .setAuthor({ name: 'Nickname Changed', iconURL: newMember.user.displayAvatarURL() })
          .setDescription(`**${newMember.user.tag}**\n**Before** ${oldMember.nickname || 'None'}\n**After** ${newMember.nickname || 'None'}`)
          .setFooter(footer(newMember.client, `ID: ${newMember.id}`));
        logCh.send({ embeds: [embed] }).catch(() => {});
      }
    },
  },
  {
    name: 'messageDelete',
    async execute(message) {
      if (!message.guild || message.author?.bot || !message.content) return;
      const logCh = getLogChannel(message.guild, message.client);
      if (!logCh) return;
      const embed = base(message.client, colors.primary)
        .setAuthor({ name: 'Message Deleted', iconURL: message.author?.displayAvatarURL() })
        .setDescription(`**Author** ${message.author?.tag || 'Unknown'} in ${message.channel}\n**Content** ${message.content.slice(0, 1024)}`)
        .setFooter(footer(message.client, `ID: ${message.id}`));
      logCh.send({ embeds: [embed] }).catch(() => {});
    },
  },
  {
    name: 'messageUpdate',
    async execute(oldMsg, newMsg) {
      if (!newMsg.guild || newMsg.author?.bot || oldMsg.content === newMsg.content) return;
      const logCh = getLogChannel(newMsg.guild, newMsg.client);
      if (!logCh) return;
      const embed = base(newMsg.client, colors.primary)
        .setAuthor({ name: 'Message Edited', iconURL: newMsg.author.displayAvatarURL() })
        .setDescription(`**Author** ${newMsg.author.tag} in ${newMsg.channel}\n**Before** ${oldMsg.content?.slice(0, 512) || '(empty)'}\n**After** ${newMsg.content.slice(0, 512)}`)
        .setURL(newMsg.url)
        .setFooter(footer(newMsg.client, `ID: ${newMsg.id}`));
      logCh.send({ embeds: [embed] }).catch(() => {});
    },
  },
  {
    name: 'roleCreate',
    async execute(role) {
      const logCh = getLogChannel(role.guild, role.client);
      if (!logCh) return;
      const embed = base(role.client, colors.primary)
        .setAuthor({ name: 'Role Created' })
        .setDescription(`**${role.name}**\nColor: ${role.hexColor}`)
        .setFooter(footer(role.client, `ID: ${role.id}`));
      logCh.send({ embeds: [embed] }).catch(() => {});
    },
  },
  {
    name: 'roleDelete',
    async execute(role) {
      const logCh = getLogChannel(role.guild, role.client);
      if (!logCh) return;
      const embed = base(role.client, colors.primary)
        .setAuthor({ name: 'Role Deleted' })
        .setDescription(`**${role.name}**`)
        .setFooter(footer(role.client, `ID: ${role.id}`));
      logCh.send({ embeds: [embed] }).catch(() => {});
    },
  },
  {
    name: 'guildMemberRemove',
    async execute(member) {
      const { guild } = member;
      if (!antinuke.isEnabled(guild.id)) return;

      const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 1 }).catch(() => null);
      if (!auditLogs) return;

      const entry = auditLogs.entries.first();
      if (!entry || Date.now() - entry.createdTimestamp > 5000) return;
      if (entry.target.id !== member.id) return;
      if (entry.executor.id === guild.client.user.id) return;
      if (entry.executor.id === guild.ownerId) return;

      const executorId = entry.executor.id;

      if (antinuke.check(guild.id, executorId, 'kick')) {
        // punishExecutor bans by id even when the executor is not cached, and reports each step.
        const { banned, rolesStripped } = await punishExecutor(guild, executorId, '[sonder antinuke] Mass kick detected');

        const modlogChannel = store.getConfig(guild.id, 'modlog_channel');
        if (modlogChannel) {
          const ch = guild.channels.cache.get(modlogChannel);
          if (ch) {
            ch.send({
              embeds: [response({
                client: guild.client,
                description: `**Antinuke triggered**\n**User** ${entry.executor.tag} \`${executorId}\`\n**Trigger** Mass kick\n${stepLines([['Ban', banned], ['Roles stripped', rolesStripped]])}`,
                color: colors.error,
              })],
            }).catch(() => {});
          }
        }

        log.warn(`[antinuke] ${entry.executor.tag} triggered mass kick in ${guild.name}`);
      }
    },
  },
];

async function fetchAuditEntry(guild, type) {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 1 });
    const entry = logs.entries.first();
    if (entry && Date.now() - entry.createdTimestamp < 5000) return entry;
  } catch {}
  return null;
}
