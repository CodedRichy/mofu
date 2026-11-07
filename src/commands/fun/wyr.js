const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');

const QUESTIONS = [
  ['Have unlimited money', 'Have unlimited knowledge'],
  ['Be able to fly', 'Be able to read minds'],
  ['Live 100 years in the past', 'Live 100 years in the future'],
  ['Be invisible', 'Be able to teleport'],
  ['Never use social media again', 'Never watch a movie again'],
  ['Have no internet', 'Have no AC or heating'],
  ['Be famous but hated', 'Be unknown but loved'],
  ['Always be 10 minutes late', 'Always be 20 minutes early'],
  ['Have free WiFi everywhere', 'Have free food everywhere'],
  ['Lose all your memories', 'Never make new ones'],
  ['Only speak in questions', 'Only speak in rhymes'],
  ['Be a wizard', 'Be a superhero'],
  ['Live without music', 'Live without TV'],
  ['Control fire', 'Control water'],
  ['Know how you die', 'Know when you die'],
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wyr')
    .setDescription('Would You Rather'),

  async execute(interaction) {
    const q = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];

    const embed = response({
      client: interaction.client,
      description: `**Would You Rather...**\n\n🅰️ ${q[0]}\n\n🅱️ ${q[1]}`,
      color: colors.primary,
    });

    await interaction.reply({ embeds: [embed] });
    const msg = await interaction.fetchReply().catch(() => null);
    if (!msg) return;
    try {
      await msg.react('🅰️');
      await msg.react('🅱️');
    } catch {
      // Missing Add Reactions permission or the message is gone: the poll still runs on whatever reactions exist
    }

    const collector = msg.createReactionCollector({ time: 30000 });

    collector.on('end', () => {
      const aReaction = msg.reactions.cache.get('🅰️');
      const bReaction = msg.reactions.cache.get('🅱️');
      const aCount = aReaction ? aReaction.count - 1 : 0;
      const bCount = bReaction ? bReaction.count - 1 : 0;
      const total = aCount + bCount;

      const aPct = total > 0 ? Math.round((aCount / total) * 100) : 0;
      const bPct = total > 0 ? Math.round((bCount / total) * 100) : 0;

      const resultsEmbed = response({
        client: interaction.client,
        description: `**Results**\n\n🅰️ ${q[0]} — **${aPct}%** (${aCount} vote${aCount !== 1 ? 's' : ''})\n\n🅱️ ${q[1]} — **${bPct}%** (${bCount} vote${bCount !== 1 ? 's' : ''})`,
        color: colors.primary,
      });

      msg.reply({ embeds: [resultsEmbed] }).catch(() => {});
    });
  },
};
