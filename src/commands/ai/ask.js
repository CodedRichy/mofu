const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const { generateResponse } = require('../../utils/ai');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask Sonder AI a question')
    .addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true)),

  cooldown: 10,

  async execute(interaction) {
    const question = interaction.options.getString('question');
    await interaction.deferReply();

    const answer = await generateResponse(question, '', { guildId: interaction.guildId });
    if (!answer) {
      return interaction.editReply({ embeds: [response({ client: interaction.client, description: 'AI unavailable. Set `GROQ_API_KEY` in .env to enable.', color: colors.error })] });
    }

    await interaction.editReply({ embeds: [response({ client: interaction.client, description: `**Q:** ${question}\n\n**A:** ${answer}`, color: colors.primary })] });
  },
};
