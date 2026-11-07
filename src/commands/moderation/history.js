const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response } = require('../../utils/embed');
const store = require('../../database/store');
const { clip, joinClipped, modLabel } = require('../../utils/modguard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription("View a user's moderation history")
    .addUserOption((o) => o.setName('user').setDescription('User to look up').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const warnings = store.getWarnings(interaction.guild.id, user.id);
    const notes = store.getNotes(interaction.guild.id, user.id);

    if (!warnings.length && !notes.length) {
      return interaction.reply({
        embeds: [response({ client: interaction.client, description: `**${user.tag}** has a clean record.`, color: colors.muted })],
        ephemeral: true,
      });
    }

    const embed = base(interaction.client, colors.primary)
      .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .setDescription(`**${warnings.length}** warnings · **${notes.length}** notes`);

    if (warnings.length) {
      const lines = warnings.slice(0, 5).map((w) => {
        const unix = Math.floor(new Date(w.timestamp).getTime() / 1000);
        return `\`#${w.id}\` ${clip(w.reason || 'No reason', 120)}\n▸ ${modLabel(w.moderator)} • <t:${unix}:R>`;
      });
      embed.addFields({ name: '⚠️ Warnings', value: joinClipped(lines, 1024) });
    }

    if (notes.length) {
      const lines = notes.slice(0, 5).map((n) => {
        const unix = Math.floor(new Date(n.timestamp).getTime() / 1000);
        return `\`#${n.id}\` ${clip(n.content, 120)}\n▸ ${modLabel(n.moderator)} • <t:${unix}:R>`;
      });
      embed.addFields({ name: '📝 Notes', value: joinClipped(lines, 1024) });
    }

    embed.setFooter({ text: `Total: ${warnings.length + notes.length} records` });

    await interaction.reply({ embeds: [embed] });
  },
};
