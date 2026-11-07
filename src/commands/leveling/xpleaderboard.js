const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response } = require('../../utils/embed');
const xpStore = require('../../database/xp');
const { fmt } = require('../../utils/visuals');

const MEDALS = ['🥇', '🥈', '🥉'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('xpleaderboard')
    .setDescription('View the top members by XP'),

  async execute(interaction) {
    const { guild } = interaction;
    const all = xpStore.getLeaderboard(guild.id, 500);
    const top = all.slice(0, 10);

    if (top.length === 0) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'No XP data yet. Start chatting to earn XP.', color: colors.muted })] });
    }

    const lines = top.map((entry, i) => {
      if (i < 3) return `${MEDALS[i]} **<@${entry.userId}>**\n> Level **${entry.level}** · ${fmt(entry.totalXp)} XP`;
      return `\`${String(i + 1).padStart(2)}.\` <@${entry.userId}> · Lv ${entry.level} · ${fmt(entry.totalXp)} XP`;
    });
    if (lines.length > 3) lines.splice(3, 0, '');
    const myIdx = all.findIndex((e) => e.userId === interaction.user.id);
    if (myIdx >= 10) {
      lines.push('', `\`${myIdx + 1}.\` **You** · Lv ${all[myIdx].level} · ${fmt(all[myIdx].totalXp)} XP`);
    }

    const embed = base(interaction.client, colors.primary)
      .setAuthor({ name: `${guild.name} — XP Leaderboard`, iconURL: guild.iconURL() })
      .setDescription(lines.join('\n'));

    await interaction.reply({ embeds: [embed] });
  },
};
