const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');

const PROMPTS = [
  'ab', 'ac', 'ad', 'al', 'am', 'an', 'ap', 'ar', 'at', 'au',
  'ba', 'be', 'bi', 'bl', 'bo', 'br', 'bu', 'ca', 'ch', 'cl',
  'co', 'cr', 'cu', 'da', 'de', 'di', 'do', 'dr', 'du', 'ea',
  'el', 'en', 'er', 'es', 'ev', 'ex', 'fa', 'fi', 'fl', 'fo',
  'fr', 'fu', 'ga', 'ge', 'gl', 'go', 'gr', 'gu', 'ha', 'he',
  'hi', 'ho', 'hu', 'ig', 'im', 'in', 'ir', 'is', 'it', 'ja',
  'jo', 'ju', 'ke', 'ki', 'kn', 'la', 'le', 'li', 'lo', 'lu',
  'ma', 'me', 'mi', 'mo', 'mu', 'na', 'ne', 'ni', 'no', 'nu',
  'ob', 'oc', 'of', 'on', 'op', 'or', 'ou', 'ov', 'pa', 'pe',
  'ph', 'pi', 'pl', 'po', 'pr', 'pu', 'qu', 'ra', 're', 'ri',
  'ro', 'ru', 'sa', 'sc', 'se', 'sh', 'si', 'sl', 'sm', 'sn',
  'so', 'sp', 'sq', 'st', 'su', 'sw', 'ta', 'te', 'th', 'ti',
  'to', 'tr', 'tu', 'tw', 'un', 'up', 'ur', 'us', 'ut', 'va',
  'vi', 'vo', 'wa', 'we', 'wh', 'wi', 'wo', 'wr',
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blacktea')
    .setDescription('Word game — type a word containing the given letters'),

  async execute(interaction) {
    const prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
    const timeLimit = 10000;

    await interaction.reply({
      embeds: [response({
        client: interaction.client,
        description: `Type a word containing **${prompt.toUpperCase()}** — you have **${timeLimit / 1000} seconds!**`,
        color: colors.primary,
      })],
    });

    const filter = (m) => {
      if (m.author.bot) return false;
      const word = m.content.toLowerCase().trim();
      return word.length >= 3 && /^[a-z]+$/.test(word) && word.includes(prompt);
    };

    try {
      const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: timeLimit, errors: ['time'] });
      const winner = collected.first();

      await interaction.followUp({
        embeds: [response({
          client: interaction.client,
          description: `${winner.author} wins with **${winner.content}**!`,
          color: colors.success,
        })],
      });
    } catch {
      await interaction.followUp({
        embeds: [response({
          client: interaction.client,
          description: `Time's up! Nobody typed a word with **${prompt.toUpperCase()}**`,
          color: colors.error,
        })],
      });
    }
  },
};
