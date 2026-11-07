const { AuditLogEvent } = require('discord.js');
const store = require('../database/store');
const antinuke = require('../database/antinuke');
const { punishExecutor, stepLines } = require('../utils/auditEntry');
const { base, response, footer } = require('../utils/embed');
const { colors } = require('../utils/constants');
const log = require('../utils/logger');

// message delete/edit are logged by events/messageDelete.js and messageUpdate.js (one embed each).
// Every logger here goes through logevents.resolve so '/logging toggle' is respected.
const logevents = require('../utils/logevents');
const getLogChannel = (guild, key) => logevents.resolve(guild, key);

module.exports = [
  {
    name: 'channelCreate',
    async execute(channel) {
      const logCh = getLogChannel(channel.guild, 'log_channels');
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
      const logCh = getLogChannel(channel.guild, 'log_channels');
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
      const logCh = getLogChannel(ban.guild, 'log_bans');
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
      const logCh = getLogChannel(ban.guild, 'log_bans');
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
      // Role changes
      const roleCh = getLogChannel(newMember.guild, 'log_role_change');
      const addedRoles = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
      const removedRoles = oldMember.roles.cache.filter((r) => !newMember.roles.cache.has(r.id));

      if (roleCh && (addedRoles.size || removedRoles.size)) {
        const lines = [];
        if (addedRoles.size) lines.push(`**Added** ${addedRoles.map((r) => r.toString()).join(', ')}`);
        if (removedRoles.size) lines.push(`**Removed** ${removedRoles.map((r) => r.toString()).join(', ')}`);
        const embed = base(newMember.client, colors.primary)
          .setAuthor({ name: 'Roles Updated', iconURL: newMember.user.displayAvatarURL() })
          .setDescription(`**${newMember.user.tag}**\n${lines.join('\n')}`)
          .setFooter(footer(newMember.client, `ID: ${newMember.id}`));
        roleCh.send({ embeds: [embed] }).catch(() => {});
      }

      // Nickname change
      const nickCh = getLogChannel(newMember.guild, 'log_nickname');
      if (nickCh && oldMember.nickname !== newMember.nickname) {
        const embed = base(newMember.client, colors.primary)
          .setAuthor({ name: 'Nickname Changed', iconURL: newMember.user.displayAvatarURL() })
          .setDescription(`**${newMember.user.tag}**\n**Before** ${oldMember.nickname || 'None'}\n**After** ${newMember.nickname || 'None'}`)
          .setFooter(footer(newMember.client, `ID: ${newMember.id}`));
        nickCh.send({ embeds: [embed] }).catch(() => {});
      }
    },
  },
  {
    name: 'roleCreate',
    async execute(role) {
      const logCh = getLogChannel(role.guild, 'log_roles_manage');
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
      const logCh = getLogChannel(role.guild, 'log_roles_manage');
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
        const { banned, rolesStripped } = await punishExecutor(guild, executorId, '[mofu antinuke] Mass kick detected');

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
