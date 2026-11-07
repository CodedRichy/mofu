const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors, BRAND } = require('../../utils/constants');
const lfdb = require('../../database/lastfm');
const crowns = require('../../utils/crowns');
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
    )
    .addSubcommand((sub) =>
      sub.setName('whoknows').setDescription('Rank linked members of this server by plays of an artist')
        .addStringOption((o) => o.setName('artist').setDescription('Artist (default: what you are listening to now)'))
    )
    .addSubcommand((sub) =>
      sub.setName('crowns').setDescription('Server crowns for artists that were looked up')
    )
    .addSubcommand((sub) =>
      sub.setName('mycrowns').setDescription('Crowns you hold in this server')
    )
    .addSubcommand((sub) =>
      sub.setName('crownrole').setDescription('Give the member with the most crowns a role (Manage Roles)')
        .addStringOption((o) => o.setName('role').setDescription('A role, or off').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('privacy').setDescription('Hide from or show in server Last.fm rankings')
        .addStringOption((o) =>
          o.setName('mode').setDescription('hide or show').setRequired(true)
            .addChoices({ name: 'hide', value: 'hide' }, { name: 'show', value: 'show' })
        )
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
    // A bare `;fm` (no subcommand) shows what you are listening to now; slash always supplies a subcommand.
    const sub = interaction.options.getSubcommand() || 'np';

    // These two only touch local settings, so they work without a Last.fm API key.
    if (sub === 'privacy') return privacy(interaction);
    if (sub === 'crownrole') return crownRoleCmd(interaction);

    if (!config.lastfm.apiKey) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Last.fm API key not configured.', color: colors.error })], ephemeral: true });
    }

    if (lfdb.getLinkedMembers(interaction.guild.id).some((m) => m.userId === interaction.user.id)) {
      lfdb.touchActive(interaction.guild.id, interaction.user.id);
    }

    if (sub === 'whoknows') return whoknows(interaction);
    if (sub === 'crowns') return crownsCmd(interaction);
    if (sub === 'mycrowns') return myCrownsCmd(interaction);

    if (sub === 'set') {
      const username = interaction.options.getString('username');
      await interaction.deferReply();
      const profile = await lastfm.getProfile(username);
      if (!profile) {
        return interaction.editReply({ embeds: [response({ client: interaction.client, description: `Last.fm user \`${username}\` not found.`, color: colors.error })] });
      }
      store.setConfig(interaction.guild.id, `lastfm_${interaction.user.id}`, username);
      lfdb.touchActive(interaction.guild.id, interaction.user.id);
      lookupCache.clearGuild(interaction.guild.id);
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

    return interaction.editReply({ embeds: [response({ client: interaction.client, description: 'Usage: `fm set <username>`, `fm whoknows [artist]`, `fm crowns`, `fm mycrowns`, `fm crownrole <role|off>`, `fm privacy hide|show`, `fm np [user]`, `fm topartists|topalbums|toptracks [period]`, `fm recent`, `fm profile [user]`.', color: colors.muted })] });
  }
}

// ---- whoknows / crowns -------------------------------------------------------------------------------------

const lookupCache = crowns.createCache();
const TTL_MIN = crowns.CACHE_TTL_MS / 60000;
const REFRESH_TOP_ARTISTS = 3; // crowns refresh looks up this many of the invoker's top artists

const err = (interaction, description) => response({ client: interaction.client, description, color: colors.error });
const note = (interaction, description) => response({ client: interaction.client, description, color: colors.muted });

function reportStatus(r) {
  const parts = [`Checked ${r.checked} of ${r.linked} linked members who are visible in rankings.`];
  if (r.linked > crowns.LOOKUP_CAP) parts.push(`Lookups are capped at the ${crowns.LOOKUP_CAP} most recently active.`);
  if (r.failed) parts.push(`${r.failed} lookups failed.`);
  if (r.aborted) parts.push('Last.fm stopped answering, so this list is partial and was not used for crowns.');
  return parts.join(' ');
}

async function presentIds(guild, ids) {
  if (!ids.length) return new Set();
  try {
    const got = await guild.members.fetch({ user: ids.slice(0, 100) });
    return new Set(got.keys());
  } catch {
    return new Set(ids.filter((id) => guild.members.cache.has(id)));
  }
}

// Rank linked, visible, present members for an artist. Cached per guild for CACHE_TTL_MS.
async function lookupArtist(interaction, artistName) {
  const guild = interaction.guild;
  const hit = lookupCache.get(guild.id, artistName);
  if (hit) return hit;

  const linked = lfdb.getLinkedMembers(guild.id).filter((m) => !m.hidden);
  const present = await presentIds(guild, linked.map((m) => m.userId));
  const visible = linked.filter((m) => present.has(m.userId));
  const targets = crowns.pickLookupTargets(visible, { cap: crowns.LOOKUP_CAP });

  const res = await crowns.collectPlays(targets, async (m) => {
    const info = await lastfm.getArtistInfo(artistName, m.username);
    return info ? { plays: info.userplaycount, artist: info.name } : null;
  });

  const canonical = res.entries.find((e) => e.artist)?.artist || artistName;
  const result = {
    artist: canonical,
    ranking: crowns.rankListeners(res.entries),
    checked: res.checked,
    linked: visible.length,
    failed: res.failed,
    aborted: res.aborted,
  };
  if (!res.aborted) {
    lookupCache.set(guild.id, artistName, result);
    lookupCache.set(guild.id, canonical, result);
    // Crowns come only from complete lookups, so a partial list cannot hand a crown to the wrong member.
    if (res.failed === 0 && res.checked === targets.length) {
      let next = crowns.applyLookup(lfdb.getCrowns(guild.id), canonical, result.ranking);
      next = crowns.dropHolders(next, (id) => !present.has(id));
      lfdb.setCrowns(guild.id, next);
    }
  }
  return result;
}

async function applyCrownRole(guild) {
  const roleId = lfdb.getCrownRole(guild.id);
  if (!roleId) return null;
  const role = guild.roles.cache.get(roleId);
  if (!role) return 'The configured crown role no longer exists.';
  if (!role.editable) return 'I cannot manage the crown role (check Manage Roles and role order).';

  const all = lfdb.getLinkedMembers(guild.id);
  const hidden = new Set(all.filter((m) => m.hidden).map((m) => m.userId));
  const stored = lfdb.getCrowns(guild.id);
  const present = await presentIds(guild, [...new Set(Object.values(stored).map((c) => c.u))]);
  const live = crowns.dropHolders(stored, (id) => hidden.has(id) || !present.has(id));
  const holderId = crowns.crownRoleHolder(live);
  const reason = `${BRAND} fm crown role`;
  try {
    for (const m of role.members.values()) {
      if (m.id !== holderId) await m.roles.remove(role, reason);
    }
    if (holderId) {
      const holder = guild.members.cache.get(holderId) || await guild.members.fetch(holderId);
      if (!holder.roles.cache.has(role.id)) await holder.roles.add(role, reason);
    }
  } catch {
    return 'I could not update the crown role.';
  }
  return null;
}

async function resolveArtist(interaction) {
  const given = interaction.options.getString('artist');
  if (given) return given.trim();
  const username = store.getConfig(interaction.guild.id, `lastfm_${interaction.user.id}`);
  if (!username) return null;
  const track = await lastfm.getNowPlaying(username);
  return track?.artist || null;
}

async function whoknows(interaction) {
  const guild = interaction.guild;
  await interaction.deferReply();
  const artistName = await resolveArtist(interaction);
  if (!artistName) {
    return interaction.editReply({ embeds: [err(interaction, `Give an artist, or link your account with ${cmdRef(guild.id, 'fm set <username>')} so I can use what you are playing.`)] });
  }
  const r = await lookupArtist(interaction, artistName);
  if (!r.ranking.length) {
    const why = r.checked === 0 ? 'No linked members could be checked.' : `None of the members I checked have plays for **${artistName}**, or the artist was not found.`;
    return interaction.editReply({ embeds: [note(interaction, `${why}\n${reportStatus(r)}`)] });
  }
  const holder = r.ranking[0].plays >= crowns.MIN_CROWN_PLAYS && !r.aborted && r.failed === 0 && r.checked > 0 ? r.ranking[0].userId : null;
  const lines = r.ranking.slice(0, 15).map((e, i) => {
    const crown = holder && i === 0 ? ' [crown]' : '';
    return `\`${i + 1}.\` <@${e.userId}> (${e.username}) - ${e.plays.toLocaleString()} plays${crown}`;
  });
  const embed = base(interaction.client, colors.primary)
    .setAuthor({ name: `Who knows ${r.artist} in ${guild.name}` })
    .setDescription(`${lines.join('\n')}\n\n${reportStatus(r)} Results are reused for ${TTL_MIN} min.`);
  const roleNote = await applyCrownRole(guild);
  if (roleNote) embed.addFields({ name: 'Crown role', value: roleNote });
  return interaction.editReply({ embeds: [embed] });
}

// Refresh crowns for the invoker's top artists (cached lookups are reused).
async function refreshCrowns(interaction) {
  const username = store.getConfig(interaction.guild.id, `lastfm_${interaction.user.id}`);
  let partial = false;
  if (username) {
    try {
      const top = await lastfm.getTopArtists(username, '3month', REFRESH_TOP_ARTISTS);
      for (const a of top) {
        const r = await lookupArtist(interaction, a.name);
        if (r.aborted) { partial = true; break; }
      }
    } catch (e) {
      if (e?.code !== 'LASTFM_UNAVAILABLE') throw e;
      partial = true;
    }
  }
  return { partial, roleNote: await applyCrownRole(interaction.guild) };
}

const CROWN_SCOPE = `Crowns exist only for artists someone looked up with whoknows, or that were in the top ${REFRESH_TOP_ARTISTS} artists of whoever ran this command, and only among the linked members that were checked.`;

async function crownsCmd(interaction) {
  const guild = interaction.guild;
  await interaction.deferReply();
  const { partial, roleNote } = await refreshCrowns(interaction);
  const stored = crowns.dropHolders(lfdb.getCrowns(guild.id), (id) => lfdb.isHidden(guild.id, id));
  const board = crowns.leaderboard(stored).slice(0, 10);
  if (!board.length) {
    return interaction.editReply({ embeds: [note(interaction, `No crowns yet. Run ${cmdRef(guild.id, 'fm whoknows <artist>')} on a few artists first.\n${CROWN_SCOPE}`)] });
  }
  const lines = board.map((b, i) => `\`${i + 1}.\` <@${b.userId}> - ${b.count} crown${b.count === 1 ? '' : 's'}`);
  const embed = base(interaction.client, colors.primary)
    .setAuthor({ name: `Crowns in ${guild.name}` })
    .setDescription(`${lines.join('\n')}\n\n${Object.keys(stored).length} artists have a crown. ${CROWN_SCOPE}${partial ? ' Last.fm was unavailable, so this used saved results only.' : ''}`);
  if (roleNote) embed.addFields({ name: 'Crown role', value: roleNote });
  return interaction.editReply({ embeds: [embed] });
}

async function myCrownsCmd(interaction) {
  const guild = interaction.guild;
  await interaction.deferReply();
  const { partial, roleNote } = await refreshCrowns(interaction);
  const mine = crowns.crownsOf(lfdb.getCrowns(guild.id), interaction.user.id);
  if (!mine.length) {
    return interaction.editReply({ embeds: [note(interaction, `You hold no crowns right now.\n${CROWN_SCOPE}`)] });
  }
  const lines = mine.slice(0, 20).map((c) => `**${c.a}** - ${Number(c.p).toLocaleString()} plays`);
  const embed = base(interaction.client, colors.primary)
    .setAuthor({ name: `${interaction.user.tag} - ${mine.length} crown${mine.length === 1 ? '' : 's'}`, iconURL: interaction.user.displayAvatarURL() })
    .setDescription(`${lines.join('\n')}\n\n${CROWN_SCOPE}${partial ? ' Last.fm was unavailable, so this used saved results only.' : ''}`);
  if (roleNote) embed.addFields({ name: 'Crown role', value: roleNote });
  return interaction.editReply({ embeds: [embed] });
}

async function privacy(interaction) {
  const guild = interaction.guild;
  const mode = String(interaction.options.getString('mode') || '').toLowerCase();
  if (mode !== 'hide' && mode !== 'show') {
    return interaction.reply({ embeds: [err(interaction, 'Use `fm privacy hide` or `fm privacy show`.')], ephemeral: true });
  }
  if (mode === 'hide') {
    lfdb.setHidden(guild.id, interaction.user.id, true);
    lfdb.setCrowns(guild.id, crowns.dropHolders(lfdb.getCrowns(guild.id), (id) => id === interaction.user.id));
    lookupCache.clearGuild(guild.id);
    await applyCrownRole(guild);
    return interaction.reply({ embeds: [response({ client: interaction.client, description: 'You are hidden from server Last.fm rankings. Your crowns here were removed and your plays are not looked up.', color: colors.success })], ephemeral: true });
  }
  lfdb.setHidden(guild.id, interaction.user.id, false);
  lookupCache.clearGuild(guild.id);
  return interaction.reply({ embeds: [response({ client: interaction.client, description: 'You are visible in server Last.fm rankings again, if your account is linked.', color: colors.success })], ephemeral: true });
}

function findRole(guild, input) {
  const m = /^<@&(\d{17,20})>$/.exec(input) || /^(\d{17,20})$/.exec(input);
  if (m) return guild.roles.cache.get(m[1]) || null;
  const lower = input.toLowerCase();
  return guild.roles.cache.find((r) => r.name.toLowerCase() === lower) || null;
}

async function crownRoleCmd(interaction) {
  const guild = interaction.guild;
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
    return interaction.reply({ embeds: [err(interaction, 'You need the Manage Roles permission to set the crown role.')], ephemeral: true });
  }
  const input = String(interaction.options.getString('role') || '').trim();
  if (!input) return interaction.reply({ embeds: [err(interaction, 'Give a role, or `off`.')], ephemeral: true });

  if (input.toLowerCase() === 'off') {
    const roleId = lfdb.getCrownRole(guild.id);
    const role = roleId ? guild.roles.cache.get(roleId) : null;
    lfdb.setCrownRole(guild.id, null);
    if (role?.editable) {
      for (const m of role.members.values()) await m.roles.remove(role, `${BRAND} fm crown role off`).catch(() => {});
    }
    return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Crown role is off. Members were removed from the old role where I was allowed to.', color: colors.success })], ephemeral: true });
  }

  const role = findRole(guild, input);
  if (!role) return interaction.reply({ embeds: [err(interaction, 'I could not find that role. Mention it, use its ID, or use its exact name.')], ephemeral: true });
  if (role.managed || role.id === guild.id) return interaction.reply({ embeds: [err(interaction, 'That role cannot be assigned by me.')], ephemeral: true });
  if (!role.editable) return interaction.reply({ embeds: [err(interaction, 'I cannot manage that role. Check my Manage Roles permission and that my top role is above it.')], ephemeral: true });
  const isOwner = guild.ownerId === interaction.user.id;
  if (!isOwner && interaction.member?.roles?.highest && role.comparePositionTo(interaction.member.roles.highest) >= 0) {
    return interaction.reply({ embeds: [err(interaction, 'That role is not below your top role.')], ephemeral: true });
  }
  lfdb.setCrownRole(guild.id, role.id);
  const noteText = await applyCrownRole(guild);
  return interaction.reply({
    embeds: [response({ client: interaction.client, description: `Crown role set to ${role} (audit log reason: ${BRAND} fm crown role). Only the one member holding the most crowns gets it, and it updates when crowns are refreshed by ${cmdRef(guild.id, 'fm whoknows')}, ${cmdRef(guild.id, 'fm crowns')} or ${cmdRef(guild.id, 'fm mycrowns')}.${noteText ? `\n${noteText}` : ''}`, color: colors.success })],
    ephemeral: true,
  });
}
