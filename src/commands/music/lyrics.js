const { SlashCommandBuilder } = require('discord.js');
const { useMainPlayer, useQueue } = require('discord-player');
const { colors } = require('../../utils/constants');
const { base, response } = require('../../utils/embed');
const log = require('../../utils/logger');

// Strip the noise YouTube titles carry so the lyrics search matches: "(Official Video)", "[HD]", "ft. ..." etc.
function cleanTitle(s) {
  return String(s || '')
    .replace(/\s+-\s+Topic\s*$/i, '')
    .replace(/\s*VEVO\s*$/i, '')
    .replace(/[(\[][^)\]]*(official|video|audio|lyrics?|visualizer|hd|4k|remaster)[^)\]]*[)\]]/gi, ' ')
    .replace(/\b(official\s+(music\s+)?(video|audio)|lyric\s+video)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lyrics')
    .setDescription('Show lyrics for the current song, or search for one')
    .addStringOption((o) => o.setName('query').setDescription('Song name (defaults to what is playing)').setRequired(false)),

  async execute(interaction) {
    let query = interaction.options.getString('query');
    const track = useQueue(interaction.guild.id)?.currentTrack;
    if (!query && track) query = `${cleanTitle(track.author)} ${cleanTitle(track.title)}`.trim();

    if (!query) {
      return interaction.reply({
        embeds: [response({ client: interaction.client, description: 'Nothing is playing. Try `/lyrics artist song`.', color: colors.muted })],
        ephemeral: true,
      });
    }

    if (interaction.deferReply) await interaction.deferReply().catch(() => {});

    let hit;
    try {
      const results = await useMainPlayer().lyrics.search({ q: query });
      hit = results.find((r) => r.plainLyrics);
    } catch (err) {
      log.warn(`lyrics lookup failed: ${err.message}`);
      interaction.failure = err.message;
    }

    if (!hit) {
      return interaction.editReply({
        embeds: [response({ client: interaction.client, description: `No lyrics found for **${query.slice(0, 100)}**.`, color: colors.muted })],
      });
    }

    const text = hit.plainLyrics.trim();
    const body = text.length > 3900 ? `${text.slice(0, 3900).replace(/\n[^\n]*$/, '')}\n\n...` : text;
    const embed = base(interaction.client, colors.primary)
      .setAuthor({ name: 'Lyrics' })
      .setTitle(`${hit.artistName} - ${hit.trackName}`.slice(0, 256))
      .setDescription(body);

    await interaction.editReply({ embeds: [embed] });
  },
};
