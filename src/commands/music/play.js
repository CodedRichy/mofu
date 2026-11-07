const { SlashCommandBuilder } = require('discord.js');
const { useMainPlayer, useQueue } = require('discord-player');
const { YoutubeExtractor } = require('discord-player-youtubei');
const { colors } = require('../../utils/constants');
const { response, base } = require('../../utils/embed');
const log = require('../../utils/logger');

// YouTube "Mix" playlists (list=RD...) are generated per viewer and the extractor cannot resolve them. When the link
// also names a specific video, play that video and drop the Mix.
function normalizeQuery(q) {
  const raw = String(q || '').trim();
  if (!/^https?:\/\//i.test(raw)) return raw;
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, '');
    const isYt = host === 'youtu.be' || host.endsWith('youtube.com');
    const hasVideo = host === 'youtu.be' ? u.pathname.length > 1 : u.searchParams.has('v');
    if (isYt && hasVideo && /^RD/i.test(u.searchParams.get('list') || '')) {
      u.searchParams.delete('list');
      u.searchParams.delete('start_radio');
      u.searchParams.delete('index');
      return u.toString();
    }
  } catch { /* not a URL after all: leave it */ }
  return raw;
}

module.exports = {
  normalizeQuery,
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song or add to queue')
    .addStringOption((o) => o.setName('query').setDescription('Song name or URL').setRequired(true)),

  async execute(interaction) {
    const channel = interaction.member.voice.channel;
    if (!channel) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Join a voice channel first.', color: colors.error })], ephemeral: true });
    }

    const botVc = interaction.guild.members.me.voice.channel;
    if (botVc && botVc.id !== channel.id) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `Already playing in ${botVc}. Join that channel or wait.`, color: colors.error })], ephemeral: true });
    }

    await interaction.deferReply();

    const player = useMainPlayer();
    const query = normalizeQuery(interaction.options.getString('query'));

    try {
      const { track, searchResult } = await player.play(channel, query, {
        nodeOptions: {
          metadata: { channel: interaction.channel },
          bufferingTimeout: 15000,
          leaveOnStop: true,
          leaveOnEmpty: true,
          leaveOnEmptyCooldown: 300000,
          leaveOnEnd: true,
          leaveOnEndCooldown: 300000,
        },
        requestedBy: interaction.user,
        // Plain-text searches go to YouTube (the official upload). 'auto' picked SoundCloud reposts first.
        // Pasted links still resolve to whichever service they belong to.
        ...(/^https?:\/\//i.test(query) ? {} : { searchEngine: `ext:${YoutubeExtractor.identifier}` }),
      });

      // A single track that starts immediately gets the now-playing card; an "Added to queue" embed on top of it
      // is the same information twice. Queued tracks and playlists still get the acknowledgement.
      const nowPlaying = useQueue(interaction.guild.id)?.currentTrack;
      if (!searchResult?.playlist && nowPlaying && nowPlaying.id === track.id) {
        await interaction.deleteReply().catch(() => {});
        return;
      }

      const embed = base(interaction.client, colors.success)
        .setAuthor({ name: 'Added to queue' })
        .setDescription(`**[${track.title}](${track.url})**\n${track.author} · ${track.duration}`)
        .setThumbnail(track.thumbnail || null);

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      const msg = String(err?.message || err);
      log.warn(`play failed for "${query}":`, msg);
      // Tell the command handler this was a failure, so telemetry does not record it as "ok".
      interaction.failure = msg.slice(0, 200);
      // A missing audio engine is the host's problem, not "no results": say so instead of misleading the user.
      const engine = /ffmpeg|opus|sodium|encryption/i.test(msg);
      const text = engine
        ? "I can't play audio right now (a problem on my side, it's been logged). Try again in a bit."
        : "Couldn't find or play that. Try a different search, or paste a link.";
      await interaction.editReply({ embeds: [response({ client: interaction.client, description: text, color: colors.error })] });
    }
  },
};
