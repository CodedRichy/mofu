const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mock')
    .setDescription('mOcK sOmEoNe\'S tExT')
    .addStringOption((o) => o.setName('text').setDescription('Text to mock').setRequired(true)),

  async execute(interaction) {
    const text = interaction.options.getString('text').slice(0, 2000);
    const mocked = [...text].map((c, i) => i % 2 ? c.toUpperCase() : c.toLowerCase()).join('');

    await interaction.reply({
      embeds: [response({ client: interaction.client, description: mocked, color: colors.primary })],
    });
  },
};
