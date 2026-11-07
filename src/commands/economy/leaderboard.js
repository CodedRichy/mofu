const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response } = require('../../utils/embed');
const store = require('../../database/store');
const { fmt } = require('../../utils/visuals');

const MEDALS = ['🥇', '🥈', '🥉'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View the richest members in the server'),

  async execute(interaction) {
    const { guild } = interaction;
    const all = store.getLeaderboard(guild.id, 500);
    const top = all.slice(0, 10);

    if (top.length === 0) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'No economy data yet. Use `/daily` to get started.', color: colors.muted })] });
    }

    const lines = top.map((entry, i) => {
      if (i < 3) return `${MEDALS[i]} **<@${entry.userId}>**\n> **⌬ ${fmt(entry.total)}**`;
      return `\`${String(i + 1).padStart(2)}.\` <@${entry.userId}> · ⌬ ${fmt(entry.total)}`;
    });
    if (lines.length > 3) lines.splice(3, 0, '');
    const myIdx = all.findIndex((e) => e.userId === interaction.user.id);
    if (myIdx >= 10) {
      lines.push('', `\`${myIdx + 1}.\` **You** · ⌬ ${fmt(all[myIdx].total)}`);
    }

    const embed = base(interaction.client, colors.primary)
      .setAuthor({ name: `${guild.name} — Leaderboard`, iconURL: guild.iconURL() })
      .setDescription(lines.join('\n'));

    await interaction.reply({ embeds: [embed] });
  },
};
