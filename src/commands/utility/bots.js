const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base } = require('../../utils/embed');
const { statusOf } = require('../../utils/presence');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bots')
    .setDescription('List all bots in this server'),

  async execute(interaction) {
    const bots = interaction.guild.members.cache
      .filter((m) => m.user.bot)
      .sort((a, b) => a.user.username.localeCompare(b.user.username));

    const desc = bots.map((m) => {
      // presence is only shown when Discord actually sent it; otherwise no dot rather than a false "offline"
      const status = statusOf(m);
      const dot = status === 'online' ? '🟢' : status === 'idle' ? '🟡' : status === 'dnd' ? '🔴' : status === 'offline' ? '⚫' : '';
      return dot ? `${dot} ${m}` : `${m}`;
    }).join('\n');

    const embed = base(interaction.client, colors.primary)
      .setAuthor({ name: `Bots — ${bots.size}` })
      .setDescription(desc || 'No bots found.');

    await interaction.reply({ embeds: [embed] });
  },
};
