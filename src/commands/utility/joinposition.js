const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { fetchAllMembers } = require('../../utils/members');
const { response } = require('../../utils/embed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('joinposition')
    .setDescription('Check when a user joined relative to others')
    .addUserOption((o) => o.setName('user').setDescription('User to check')),

  async execute(interaction) {
    const target = interaction.options.getMember('user') || interaction.member;

    const members = await fetchAllMembers(interaction.guild);
    const sorted = [...members.values()]
      .filter((m) => m.joinedTimestamp)
      .sort((a, b) => a.joinedTimestamp - b.joinedTimestamp);

    const position = sorted.findIndex((m) => m.id === target.id) + 1;

    if (!position) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Could not determine join position.', color: colors.error })], ephemeral: true });
    }

    await interaction.reply({
      embeds: [response({
        client: interaction.client,
        description: `${target} was the **#${position}** member to join (out of **${sorted.length}**)`,
        color: colors.primary,
      })],
    });
  },
};
