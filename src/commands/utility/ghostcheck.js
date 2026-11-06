const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { fetchAllMembers } = require('../../utils/members');
const { base, response } = require('../../utils/embed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ghostcheck')
    .setDescription('Find members with zero engagement')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((o) => o.setName('days').setDescription('Minimum days in server (default 30)').setMinValue(7).setMaxValue(365)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const minDays = interaction.options.getInteger('days') || 30;
    const cutoff = Date.now() - minDays * 86400000;

    const members = await fetchAllMembers(interaction.guild);
    const ghosts = members.filter((m) =>
      !m.user.bot &&
      m.joinedTimestamp &&
      m.joinedTimestamp < cutoff &&
      m.roles.cache.size <= 1
    );

    if (!ghosts.size) {
      return interaction.editReply({ embeds: [response({ client: interaction.client, description: `No ghost members found (${minDays}+ days, no roles).`, color: colors.success })] });
    }

    const sorted = [...ghosts.values()].sort((a, b) => a.joinedTimestamp - b.joinedTimestamp);
    const sample = sorted.slice(0, 15);

    const desc = [
      `**${ghosts.size}** members joined ${minDays}+ days ago with no roles\n`,
      ...sample.map((m) => {
        const days = Math.floor((Date.now() - m.joinedTimestamp) / 86400000);
        return `${m} — joined **${days}d** ago`;
      }),
      ghosts.size > 15 ? `\n*...and ${ghosts.size - 15} more*` : '',
    ].join('\n');

    const embed = base(interaction.client, colors.warning)
      .setAuthor({ name: 'Ghost Check' })
      .setDescription(desc)
      .setFooter({ text: 'These members may have never engaged. Consider a welcome nudge or review.' });

    await interaction.editReply({ embeds: [embed] });
  },
};
