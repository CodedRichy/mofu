const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const { analyzeSentiment } = require('../../utils/ai');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sentiment')
    .setDescription('Analyze sentiment of recent messages')
    .addIntegerOption((o) => o.setName('messages').setDescription('Number of messages to analyze (5-50)').setMinValue(5).setMaxValue(50))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const count = interaction.options.getInteger('messages') || 20;
    await interaction.deferReply();

    const messages = await interaction.channel.messages.fetch({ limit: count });
    const filtered = messages.filter((m) => !m.author.bot && m.content.length > 5).reverse();

    if (filtered.size < 3) {
      return interaction.editReply({ embeds: [response({ client: interaction.client, description: 'Not enough messages to analyze.', color: colors.error })] });
    }

    const results = { positive: 0, negative: 0, neutral: 0, toxic: 0 };
    for (const msg of filtered.values()) {
      const sentiment = await analyzeSentiment(msg.content, { guildId: interaction.guildId });
      if (sentiment && results[sentiment] !== undefined) results[sentiment]++;
    }

    const total = Object.values(results).reduce((a, b) => a + b, 0) || 1;
    const lines = [
      `Analyzed **${filtered.size}** messages:\n`,
      `😊 **Positive** — ${results.positive} (${Math.round(results.positive / total * 100)}%)`,
      `😐 **Neutral** — ${results.neutral} (${Math.round(results.neutral / total * 100)}%)`,
      `😠 **Negative** — ${results.negative} (${Math.round(results.negative / total * 100)}%)`,
      `☠️ **Toxic** — ${results.toxic} (${Math.round(results.toxic / total * 100)}%)`,
    ];

    await interaction.editReply({ embeds: [response({ client: interaction.client, description: lines.join('\n'), color: colors.primary })] });
  },
};
