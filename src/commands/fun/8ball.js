const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');

const RESPONSES = [
  'It is certain.', 'It is decidedly so.', 'Without a doubt.', 'Yes, definitely.',
  'You may rely on it.', 'As I see it, yes.', 'Most likely.', 'Outlook good.',
  'Yes.', 'Signs point to yes.', 'Reply hazy, try again.', 'Ask again later.',
  'Better not tell you now.', 'Cannot predict now.', 'Concentrate and ask again.',
  "Don't count on it.", 'My reply is no.', 'My sources say no.',
  'Outlook not so good.', 'Very doubtful.',
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Ask the magic 8ball a question')
    .addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true)),

  async execute(interaction) {
    const question = interaction.options.getString('question').slice(0, 1000);
    const answer = RESPONSES[Math.floor(Math.random() * RESPONSES.length)];

    await interaction.reply({
      embeds: [response({
        client: interaction.client,
        description: `🎱 **${question}**\n\n${answer}`,
        color: colors.primary,
      })],
    });
  },
};
