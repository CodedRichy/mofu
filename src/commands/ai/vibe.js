const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response } = require('../../utils/embed');
const { chat } = require('../../utils/ai');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vibe')
    .setDescription('Read the room — analyze the channel\'s current mood')
    .addIntegerOption((o) =>
      o.setName('messages').setDescription('Number of messages to analyze').setMinValue(10).setMaxValue(100)
    ),

  cooldown: 30,

  async execute(interaction) {
    const count = interaction.options.getInteger('messages') || 30;

    await interaction.deferReply();

    const fetched = await interaction.channel.messages.fetch({ limit: count });
    const humanMessages = fetched.filter((m) => !m.author.bot);

    if (humanMessages.size < 5) {
      return interaction.editReply({
        embeds: [response({ client: interaction.client, description: 'Not enough recent messages to read the room.', color: colors.error })],
        ephemeral: true,
      });
    }

    const transcript = humanMessages
      .reverse()
      .map((m) => `${m.member?.displayName || m.author.displayName}: ${m.content}`)
      .join('\n')
      .slice(0, 3000);

    const humanMsgCount = humanMessages.size;

    const result = await chat(
      [
        {
          role: 'system',
          content: 'You are analyzing the mood of a Discord channel\'s recent conversation. Give a brief vibe check (3-4 sentences). Include: the overall mood/energy, what people seem to be talking about, and the general tone. Use a casual, observant voice. End with one emoji that captures the overall vibe. Do not use bullet points.',
        },
        {
          role: 'user',
          content: `Here are the last ${humanMsgCount} messages from the channel:\n\n${transcript}`,
        },
      ],
      { maxTokens: 200, temperature: 0.7, guildId: interaction.guildId }
    );

    if (!result) {
      return interaction.editReply({
        embeds: [response({ client: interaction.client, description: 'Failed to analyze the channel mood. Try again later.', color: colors.error })],
        ephemeral: true,
      });
    }

    const embed = base(interaction.client, colors.primary)
      .setAuthor({ name: 'vibe check', iconURL: interaction.client.user.displayAvatarURL() })
      .setDescription(result)
      .setFooter({ text: `based on ${humanMsgCount} messages` });

    await interaction.editReply({ embeds: [embed] });
  },
};
