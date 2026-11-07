const { SlashCommandBuilder, PermissionFlagsBits, AuditLogEvent } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response, footer } = require('../../utils/embed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('modstats')
    .setDescription('View moderation team activity')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((o) => o.setName('moderator').setDescription('View a specific mod\'s action history')),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const [bans, kicks, timeouts] = await Promise.all([
        interaction.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 100 }).catch(() => ({ entries: [] })),
        interaction.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 100 }).catch(() => ({ entries: [] })),
        interaction.guild.fetchAuditLogs({ type: AuditLogEvent.MemberUpdate, limit: 100 }).catch(() => ({ entries: [] })),
      ]);

      const timeoutEntries = [...timeouts.entries.values()].filter((e) =>
        e.changes?.some((c) => c.key === 'communication_disabled_until')
      );

      const targetMod = interaction.options.getUser('moderator');
      const modActions = new Map();

      function addAction(executor, type) {
        if (!executor || executor.bot) return;
        if (targetMod && executor.id !== targetMod.id) return;
        if (!modActions.has(executor.id)) {
          modActions.set(executor.id, { tag: executor.tag, bans: 0, kicks: 0, timeouts: 0, total: 0 });
        }
        const stats = modActions.get(executor.id);
        stats[type]++;
        stats.total++;
      }

      for (const entry of bans.entries.values()) addAction(entry.executor, 'bans');
      for (const entry of kicks.entries.values()) addAction(entry.executor, 'kicks');
      for (const entry of timeoutEntries) addAction(entry.executor, 'timeouts');

      if (!modActions.size) {
        return interaction.editReply({ embeds: [response({ client: interaction.client, description: 'No moderation actions found in recent audit logs.', color: colors.muted })] });
      }

      const sorted = [...modActions.values()].sort((a, b) => b.total - a.total);

      if (targetMod) {
        const stats = sorted[0];
        if (!stats) {
          return interaction.editReply({ embeds: [response({ client: interaction.client, description: `No actions found for ${targetMod}.`, color: colors.muted })] });
        }

        const desc = [
          `**Total Actions** ${stats.total}`,
          `**Bans** ${stats.bans}`,
          `**Kicks** ${stats.kicks}`,
          `**Timeouts** ${stats.timeouts}`,
          '',
          `**Style** ${stats.bans > stats.timeouts ? 'Heavy-handed (more bans than timeouts)' : stats.timeouts > stats.bans ? 'Measured (prefers timeouts over bans)' : 'Balanced'}`,
        ].join('\n');

        const embed = base(interaction.client, colors.primary)
          .setAuthor({ name: `Mod Stats — ${stats.tag}`, iconURL: targetMod.displayAvatarURL() })
          .setDescription(desc);

        return interaction.editReply({ embeds: [embed] });
      }

      const desc = sorted.slice(0, 10).map((s, i) =>
        `\`${i + 1}.\` **${s.tag}** — ${s.total} actions (${s.bans}B/${s.kicks}K/${s.timeouts}T)`
      ).join('\n');

      const totalActions = sorted.reduce((sum, s) => sum + s.total, 0);

      const embed = base(interaction.client, colors.primary)
        .setAuthor({ name: 'Mod Team Stats' })
        .setDescription(`**${totalActions}** total actions · **${sorted.length}** active mods\n\n${desc}`)
        .setFooter(footer(interaction.client, 'Based on recent audit log entries · B=Bans K=Kicks T=Timeouts'));

      await interaction.editReply({ embeds: [embed] });
    } catch {
      await interaction.editReply({ embeds: [response({ client: interaction.client, description: 'Failed to fetch audit logs.', color: colors.error })] });
    }
  },
};
