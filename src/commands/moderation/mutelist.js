const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { fetchAllMembers } = require('../../utils/members');
const { base, response } = require('../../utils/embed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mutelist')
    .setDescription('List currently timed out members')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    await interaction.deferReply();

    const members = await fetchAllMembers(interaction.guild);
    const muted = members.filter((m) => m.communicationDisabledUntilTimestamp && m.communicationDisabledUntilTimestamp > Date.now());

    if (!muted.size) {
      return interaction.editReply({ embeds: [response({ client: interaction.client, description: 'No members are currently timed out.', color: colors.muted })] });
    }

    const desc = muted.map((m) =>
      `${m} — expires <t:${Math.floor(m.communicationDisabledUntilTimestamp / 1000)}:R>`
    ).join('\n');

    const embed = base(interaction.client, colors.primary)
      .setAuthor({ name: `Muted Members — ${muted.size}` })
      .setDescription(desc);

    await interaction.editReply({ embeds: [embed] });
  },
};
