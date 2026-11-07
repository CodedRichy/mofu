const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response } = require('../../utils/embed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('besttime')
    .setDescription('Find when this server is most active')
    .addChannelOption((o) => o.setName('channel').setDescription('Specific channel (omit for whole server)').addChannelTypes(ChannelType.GuildText)),

  async execute(interaction) {
    await interaction.deferReply();

    const channel = interaction.options.getChannel('channel') || interaction.channel;

    try {
      const hourCounts = new Array(24).fill(0);
      const dayCounts = new Array(7).fill(0);
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      let totalMessages = 0;
      let lastId;

      for (let i = 0; i < 10; i++) {
        const batch = await channel.messages.fetch({ limit: 100, ...(lastId && { before: lastId }) });
        if (!batch.size) break;

        for (const msg of batch.values()) {
          if (msg.author.bot) continue;
          const d = msg.createdAt;
          hourCounts[d.getHours()]++;
          dayCounts[d.getDay()]++;
          totalMessages++;
        }
        lastId = batch.last().id;
      }

      if (totalMessages < 20) {
        return interaction.editReply({ embeds: [response({ client: interaction.client, description: 'Not enough messages to analyze (need 20+).', color: colors.muted })] });
      }

      const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
      const peakDay = dayCounts.indexOf(Math.max(...dayCounts));
      const deadHour = hourCounts.indexOf(Math.min(...hourCounts));

      const maxCount = Math.max(...hourCounts);
      const barChart = hourCounts.map((c, h) => {
        const bar = maxCount > 0 ? '█'.repeat(Math.round((c / maxCount) * 8)) : '';
        const label = `${String(h).padStart(2, '0')}:00`;
        return `\`${label}\` ${bar || '░'} ${c}`;
      }).join('\n');

      const embed = base(interaction.client, colors.primary)
        .setAuthor({ name: `Best Time — #${channel.name}` }) // claim-ok: feature name; body shows the computed busiest hours
        .setDescription(
          `Based on **${totalMessages}** recent messages\n\n` +
          `**Peak Hour** ${peakHour}:00 (${hourCounts[peakHour]} msgs)\n` +
          `**Peak Day** ${dayNames[peakDay]} (${dayCounts[peakDay]} msgs)\n` +
          `**Dead Hour** ${deadHour}:00 (${hourCounts[deadHour]} msgs)\n\n` +
          `**Hourly Breakdown**\n${barChart}`
        );

      await interaction.editReply({ embeds: [embed] });
    } catch {
      await interaction.editReply({ embeds: [response({ client: interaction.client, description: 'Failed to analyze messages.', color: colors.error })] });
    }
  },
};
