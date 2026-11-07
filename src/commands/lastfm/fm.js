const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response } = require('../../utils/embed');
const { cmdRef } = require('../../utils/invocation');
const store = require('../../database/store');
const lastfm = require('../../utils/lastfm');
const config = require('../../config');

const PERIODS = [
  { name: 'Week', value: '7day' },
  { name: 'Month', value: '1month' },
  { name: '3 Months', value: '3month' },
  { name: '6 Months', value: '6month' },
  { name: 'Year', value: '12month' },
  { name: 'All Time', value: 'overall' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('fm')
    .setDescription('Last.fm commands')
    .addSubcommand((sub) =>
      sub.setName('set').setDescription('Link your Last.fm account')
        .addStringOption((o) => o.setName('username').setDescription('Your Last.fm username').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('np').setDescription('Show what you\'re currently listening to')
        .addUserOption((o) => o.setName('user').setDescription('User to check'))
    )
    .addSubcommand((sub) =>
      sub.setName('topartists').setDescription('View top artists')
        .addStringOption((o) =>
          o.setName('period').setDescription('Time period')
            .addChoices(...PERIODS)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('topalbums').setDescription('View top albums')
        .addStringOption((o) =>
          o.setName('period').setDescription('Time period')
            .addChoices(...PERIODS)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('toptracks').setDescription('View top tracks')
        .addStringOption((o) =>
          o.setName('period').setDescription('Time period')
            .addChoices(...PERIODS)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('recent').setDescription('View recent tracks')
    )
    .addSubcommand((sub) =>
      sub.setName('profile').setDescription('View Last.fm profile')
        .addUserOption((o) => o.setName('user').setDescription('User to check'))
    ),

  async execute(interaction) {
    try {
      return await run(interaction);
    } catch (err) {
      if (err?.code !== 'LASTFM_UNAVAILABLE') throw err;
      const payload = { embeds: [response({ client: interaction.client, description: 'Last.fm is having trouble right now, try again in a minute.', color: colors.error })] };
      if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
      return interaction.reply({ ...payload, ephemeral: true });
    }
  },
};

async function run(interaction) {
  {
    if (!config.lastfm.apiKey) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Last.fm API key not configured.', color: colors.error })], ephemeral: true });
    }

    // A bare `;fm` (no subcommand) shows what you are listening to now; slash always supplies a subcommand.
    const sub = interaction.options.getSubcommand() || 'np';

    if (sub === 'set') {
      const username = interaction.options.getString('username');
      await interaction.deferReply();
      const profile = await lastfm.getProfile(username);
      if (!profile) {
        return interaction.editReply({ embeds: [response({ client: interaction.client, description: `Last.fm user \`${username}\` not found.`, color: colors.error })] });
      }
      store.setConfig(interaction.guild.id, `lastfm_${interaction.user.id}`, username);
      return interaction.editReply({ embeds: [response({ client: interaction.client, description: `Last.fm linked to **${username}** (${Number(profile.playcount).toLocaleString()} scrobbles) in this server. Run \`fm set\` again in other servers you use me in.`, color: colors.success })] });
    }

    const targetUser = interaction.options.getUser('user') || interaction.user;
    const username = store.getConfig(interaction.guild.id, `lastfm_${targetUser.id}`);
    if (!username) {
      return interaction.reply({
        embeds: [response({ client: interaction.client, description: `${targetUser.id === interaction.user.id ? 'You haven\'t' : `${targetUser.tag} hasn't`} linked a Last.fm account.\nUse ${cmdRef(interaction.guild.id, 'fm set <username>')}`, color: colors.error })],
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    if (sub === 'np') {
      const track = await lastfm.getNowPlaying(username);
      if (!track) {
        return interaction.editReply({ embeds: [response({ client: interaction.client, description: 'No recent tracks found.', color: colors.muted })] });
      }

      const embed = base(interaction.client, colors.primary)
        .setAuthor({ name: `${targetUser.tag} — ${track.nowPlaying ? 'Now Playing' : 'Last Played'}`, iconURL: targetUser.displayAvatarURL() })
        .setDescription(`**[${track.name}](${track.url})**\nby **${track.artist}**${track.album ? `\non *${track.album}*` : ''}`);

      if (track.image) embed.setThumbnail(track.image);
      return interaction.editReply({ embeds: [embed] });

    } else if (sub === 'topartists') {
      const period = interaction.options.getString('period') || '7day';
      const artists = await lastfm.getTopArtists(username, period);
      if (!artists.length) return interaction.editReply({ embeds: [response({ client: interaction.client, description: 'No data found.', color: colors.muted })] });

      const periodLabel = PERIODS.find((p) => p.value === period)?.name || period;
      const list = artists.map((a, i) => `\`${i + 1}.\` **${a.name}** — ${Number(a.playcount).toLocaleString()} plays`).join('\n');

      const embed = base(interaction.client, colors.primary)
        .setAuthor({ name: `${username} — Top Artists (${periodLabel})`, iconURL: targetUser.displayAvatarURL() })
        .setDescription(list);
      return interaction.editReply({ embeds: [embed] });

    } else if (sub === 'topalbums') {
      const period = interaction.options.getString('period') || '7day';
      const albums = await lastfm.getTopAlbums(username, period);
      if (!albums.length) return interaction.editReply({ embeds: [response({ client: interaction.client, description: 'No data found.', color: colors.muted })] });

      const periodLabel = PERIODS.find((p) => p.value === period)?.name || period;
      const list = albums.map((a, i) => `\`${i + 1}.\` **${a.name}** — ${a.artist} (${Number(a.playcount).toLocaleString()} plays)`).join('\n');

      const embed = base(interaction.client, colors.primary)
        .setAuthor({ name: `${username} — Top Albums (${periodLabel})`, iconURL: targetUser.displayAvatarURL() })
        .setDescription(list);
      if (albums[0]?.image) embed.setThumbnail(albums[0].image);
      return interaction.editReply({ embeds: [embed] });

    } else if (sub === 'toptracks') {
      const period = interaction.options.getString('period') || '7day';
      const tracks = await lastfm.getTopTracks(username, period);
      if (!tracks.length) return interaction.editReply({ embeds: [response({ client: interaction.client, description: 'No data found.', color: colors.muted })] });

      const periodLabel = PERIODS.find((p) => p.value === period)?.name || period;
      const list = tracks.map((t, i) => `\`${i + 1}.\` **[${t.name}](${t.url})** — ${t.artist} (${Number(t.playcount).toLocaleString()} plays)`).join('\n');

      const embed = base(interaction.client, colors.primary)
        .setAuthor({ name: `${username} — Top Tracks (${periodLabel})`, iconURL: targetUser.displayAvatarURL() })
        .setDescription(list);
      return interaction.editReply({ embeds: [embed] });

    } else if (sub === 'recent') {
      const tracks = await lastfm.getRecentTracks(username);
      if (!tracks.length) return interaction.editReply({ embeds: [response({ client: interaction.client, description: 'No recent tracks.', color: colors.muted })] });

      const list = tracks.map((t, i) => `${t.nowPlaying ? '▶️' : `\`${i + 1}.\``} **${t.name}** — ${t.artist}`).join('\n');

      const embed = base(interaction.client, colors.primary)
        .setAuthor({ name: `${username} — Recent Tracks`, iconURL: targetUser.displayAvatarURL() })
        .setDescription(list);
      return interaction.editReply({ embeds: [embed] });

    } else if (sub === 'profile') {
      const profile = await lastfm.getProfile(username);
      if (!profile) return interaction.editReply({ embeds: [response({ client: interaction.client, description: 'Profile not found.', color: colors.error })] });

      const embed = base(interaction.client, colors.primary)
        .setAuthor({ name: profile.name, iconURL: targetUser.displayAvatarURL(), url: profile.url })
        .setDescription(
          `${profile.realname ? `**${profile.realname}**\n` : ''}` +
          `**Scrobbles** ${Number(profile.playcount).toLocaleString()}\n` +
          `${profile.country && profile.country !== 'None' ? `**Country** ${profile.country}\n` : ''}` +
          `**Registered** <t:${profile.registered}:R>`
        );

      if (profile.image) embed.setThumbnail(profile.image);
      return interaction.editReply({ embeds: [embed] });
    }

    return interaction.editReply({ embeds: [response({ client: interaction.client, description: 'Usage: `fm set <username>`, `fm np [user]`, `fm topartists|topalbums|toptracks [period]`, `fm recent`, `fm profile [user]`.', color: colors.muted })] });
  }
}
