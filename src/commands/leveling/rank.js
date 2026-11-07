const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base } = require('../../utils/embed');
const xpStore = require('../../database/xp');
const { bar, fmt } = require('../../utils/visuals');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('View your or another member\'s level and XP')
    .addUserOption((o) => o.setName('user').setDescription('Member to check')),

  async execute(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    const stats = xpStore.getStats(interaction.guild.id, user.id);
    const rank = xpStore.getRank(interaction.guild.id, user.id);
    const pct = stats.needed > 0 ? Math.min(1, stats.xp / stats.needed) : 0;
    let total = 0;
    try { total = xpStore.getLeaderboard(interaction.guild.id, 100000).length; } catch { total = 0; }
    const rankText = total >= rank ? `#${rank} of ${fmt(total)}` : `#${rank}`;

    const embed = base(interaction.client, colors.primary)
      .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .setDescription(
        `**Rank** ${rankText}\n` +
        `**Level** ${stats.level}\n` +
        `**XP** ${fmt(stats.xp)} / ${fmt(stats.needed)}\n\n` +
        `${bar(pct, 12)} **${Math.floor(pct * 100)}%**\n` +
        `${fmt(Math.max(0, stats.needed - stats.xp))} XP to level ${stats.level + 1}`
      );

    await interaction.reply({ embeds: [embed] });
  },
};
