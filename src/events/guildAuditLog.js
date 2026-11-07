const { AuditLogEvent, Events } = require('discord.js');
const store = require('../database/store');
const { base, footer } = require('../utils/embed');
const { colors } = require('../utils/constants');

module.exports = {
  name: Events.GuildAuditLogEntryCreate,
  async execute(entry, guild) {
    const logChannel = store.getConfig(guild.id, 'audit_log_channel');
    if (!logChannel) return;

    const channel = guild.channels.cache.get(logChannel);
    if (!channel) return;

    const executor = entry.executor ? `${entry.executor.tag}` : 'Unknown';
    const target = entry.target;
    let description = null;

    switch (entry.action) {
      case AuditLogEvent.MemberBanAdd:
        description = `**Member Banned**\n**User:** ${target.tag} (${target.id})\n**By:** ${executor}\n**Reason:** ${entry.reason || 'None'}`;
        break;
      case AuditLogEvent.MemberBanRemove:
        description = `**Member Unbanned**\n**User:** ${target.tag} (${target.id})\n**By:** ${executor}`;
        break;
      case AuditLogEvent.MemberKick:
        description = `**Member Kicked**\n**User:** ${target.tag} (${target.id})\n**By:** ${executor}\n**Reason:** ${entry.reason || 'None'}`;
        break;
      case AuditLogEvent.MemberRoleUpdate: {
        const added = entry.changes?.find((c) => c.key === '$add');
        const removed = entry.changes?.find((c) => c.key === '$remove');
        const parts = [];
        if (added?.new?.length) parts.push(`**Added:** ${added.new.map((r) => r.name).join(', ')}`);
        if (removed?.new?.length) parts.push(`**Removed:** ${removed.new.map((r) => r.name).join(', ')}`);
        if (parts.length) description = `**Role Update**\n**User:** ${target.tag}\n**By:** ${executor}\n${parts.join('\n')}`;
        break;
      }
      case AuditLogEvent.ChannelCreate:
        description = `**Channel Created**\n**Name:** #${target.name}\n**By:** ${executor}`;
        break;
      case AuditLogEvent.ChannelDelete:
        description = `**Channel Deleted**\n**Name:** #${entry.changes?.find((c) => c.key === 'name')?.old || 'unknown'}\n**By:** ${executor}`;
        break;
      case AuditLogEvent.RoleCreate:
        description = `**Role Created**\n**Name:** ${target.name}\n**By:** ${executor}`;
        break;
      case AuditLogEvent.RoleDelete:
        description = `**Role Deleted**\n**Name:** ${entry.changes?.find((c) => c.key === 'name')?.old || 'unknown'}\n**By:** ${executor}`;
        break;
      case AuditLogEvent.MessageDelete:
        description = `**Message Deleted**\n**Channel:** <#${entry.extra?.channel?.id || 'unknown'}>\n**Author:** ${target?.tag || 'Unknown'}\n**By:** ${executor}`;
        break;
      case AuditLogEvent.MessageBulkDelete:
        description = `**Bulk Delete**\n**Channel:** <#${entry.extra?.channel?.id || target?.id || 'unknown'}>\n**Count:** ${entry.extra?.count || '?'}\n**By:** ${executor}`;
        break;
    }

    if (!description) return;

    const embed = base(guild.client, colors.muted)
      .setDescription(description)
      .setFooter(footer(guild.client, `Audit Log • ${executor}`))
      .setTimestamp();

    channel.send({ embeds: [embed] }).catch(() => {});
  },
};
