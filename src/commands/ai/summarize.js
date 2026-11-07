const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const { summarize } = require('../../utils/ai');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('summarize')
    .setDescription('AI-summarize recent conversation in this channel')
    .addIntegerOption((o) => o.setName('messages').setDescription('Number of messages to summarize (10-100)').setMinValue(10).setMaxValue(100))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const count = interaction.options.getInteger('messages') || 50;
    await interaction.deferReply();

    const messages = await interaction.channel.messages.fetch({ limit: count });
    const filtered = messages
      .filter((m) => !m.author.bot && m.content.length > 0)
      .reverse()
      .map((m) => ({ author: m.author.username, content: m.content }));

    if (filtered.length < 3) {
      return interaction.editReply({ embeds: [response({ client: interaction.client, description: 'Not enough messages to summarize.', color: colors.error })] });
    }

    const summary = await summarize(filtered, { guildId: interaction.guildId });
    if (!summary) {
      return interaction.editReply({ embeds: [response({ client: interaction.client, description: 'AI is unavailable right now. Try again later.', color: colors.error })] });
    }

    const head = `**Channel Summary** (${filtered.length} member messages out of the last ${messages.size})\n\n`;
    const room = 4096 - head.length;
    const body = summary.length > room ? `${summary.slice(0, room - 14)}... (cut off)` : summary;
    await interaction.editReply({ embeds: [response({ client: interaction.client, description: `${head}${body}`, color: colors.primary })] });
  },
};
