const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { modAction, dmNotice, response, base } = require('../../utils/embed');
const store = require('../../database/store');
const modlog = require('../../utils/modlog');
const { reasonError, clip, joinClipped, modLabel } = require('../../utils/modguard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Manage member warnings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((s) =>
      s.setName('add')
        .setDescription('Warn a member')
        .addUserOption((o) => o.setName('user').setDescription('Member to warn').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason for warning').setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName('list')
        .setDescription('View warnings for a member')
        .addUserOption((o) => o.setName('user').setDescription('Member to check').setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName('clear')
        .setDescription('Clear all warnings for a member')
        .addUserOption((o) => o.setName('user').setDescription('Member to clear warnings for').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');

      if (user.id === interaction.user.id) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: "You can't warn yourself.", color: colors.error })], ephemeral: true });
      }

      if (user.bot) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: "You can't warn a bot.", color: colors.error })], ephemeral: true });
      }

      const reasonErr = reasonError(reason);
      if (reasonErr) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: reasonErr, color: colors.error })], ephemeral: true });
      }

      store.addWarning(interaction.guild.id, user.id, {
        reason,
        moderatorId: interaction.user.id,
      });

      const warnings = store.getWarnings(interaction.guild.id, user.id);

      await user.send({ embeds: [dmNotice({ guild: interaction.guild, action: 'warned', reason, color: colors.warning })] }).catch(() => {});

      const embed = modAction({
        client: interaction.client,
        action: 'warn',
        color: colors.warning,
        target: user,
        moderator: interaction.user,
        reason,
        extra: `Warning #${warnings.length}`,
      });

      await interaction.reply({ embeds: [embed] });
      await modlog.send(interaction.guild, { action: 'warn', target: user, moderator: interaction.user, reason, extra: `Total: ${warnings.length}` });
    } else if (sub === 'list') {
      const user = interaction.options.getUser('user');
      const warnings = store.getWarnings(interaction.guild.id, user.id);

      if (warnings.length === 0) {
        const embed = base(interaction.client, colors.success)
          .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
          .setThumbnail(user.displayAvatarURL({ size: 256 }))
          .setDescription('No warnings on record.');

        return interaction.reply({ embeds: [embed] });
      }

      const list = joinClipped(warnings.map((w, i) => {
        const ts = Math.floor(new Date(w.timestamp).getTime() / 1000);
        return `\`${i + 1}\` ${clip(w.reason || 'No reason', 300)}\n  ▸ ${modLabel(w.moderatorId)} · <t:${ts}:R>`;
      }), 4000, '\n\n');

      const embed = base(interaction.client, colors.warning)
        .setAuthor({ name: `${user.tag} — ${warnings.length} warning(s)`, iconURL: user.displayAvatarURL() })
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .setDescription(list);

      await interaction.reply({ embeds: [embed] });
    } else if (sub === 'clear') {
      const user = interaction.options.getUser('user');
      const count = store.clearWarnings(interaction.guild.id, user.id);

      if (count === 0) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `**${user.tag}** has no warnings to clear.`, color: colors.muted })], ephemeral: true });
      }

      const embed = response({
        client: interaction.client,
        description: `Cleared **${count}** warning(s) from **${user.tag}**`,
        color: colors.success,
      });

      await interaction.reply({ embeds: [embed] });
      await modlog.send(interaction.guild, { action: 'clearwarns', target: user, moderator: interaction.user, reason: `Cleared ${count} warning(s)` });
    }
  },
};
