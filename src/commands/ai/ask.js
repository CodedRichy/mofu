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
      return interaction.editReply({ embeds: [response({ client: interaction.client, description: 'AI is unavailable right now. Try again later.', color: colors.error })] });
    }

    // Embed descriptions cap at 4096: clip the question to 500 and the answer to what is left, and say so.
    const q = question.length > 500 ? `${question.slice(0, 497)}...` : question;
    const head = `**Q:** ${q}\n\n**A:** `;
    const room = 4096 - head.length;
    const a = answer.length > room ? `${answer.slice(0, room - 14)}... (cut off)` : answer;
    await interaction.editReply({ embeds: [response({ client: interaction.client, description: `${head}${a}`, color: colors.primary })] });
  },
};
