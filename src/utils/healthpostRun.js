// Glue for the weekly health post: gathers counters for a guild, renders the embed, runs the weekly sweep.
// No automatic actions and no DMs: the only output is one embed in the channel staff chose.
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const stats = require('../database/healthstats');
const H = require('./healthpost');
const log = require('./logger');

const SWEEP_MS = 60 * 60 * 1000;
const NO_PINGS = { parse: [] };

// Text channels everyone can see (staff-only channels are not "quiet", they are private).
function visibleTextChannels(guild) {
  const everyone = guild.roles?.everyone;
  return [...guild.channels.cache.values()]
    .filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
    .filter((c) => !everyone || c.permissionsFor?.(everyone)?.has(PermissionFlagsBits.ViewChannel))
    .map((c) => ({ id: c.id, name: c.name, createdAt: c.createdTimestamp }));
}

function buildForGuild(guild, now = Date.now()) {
  const cfg = stats.getConfig(guild.id);
  const snap = stats.snapshot(guild.id, now);
  return H.buildReport({
    now,
    daily: snap.daily,
    counts: snap.counts,
    channels: visibleTextChannels(guild),
    excluded: cfg.excluded,
    questions: snap.questions.filter((q) => cfg.helpChannels.includes(q.channelId)),
    helpChannelCount: cfg.helpChannels.length,
    since: cfg.since,
  });
}

function embedForGuild(client, guild, now = Date.now()) {
  return H.renderEmbed(client, buildForGuild(guild, now), { guildName: guild.name });
}

// True when this guild is due: enabled, has a channel, and a full window passed since the last post (or since enabling).
function isDue(cfg, now) {
  if (!cfg.enabled || !cfg.channelId) return false;
  const anchor = cfg.lastPostAt ?? cfg.since;
  return Number.isFinite(anchor) && now - anchor >= H.WINDOW_DAYS * H.DAY_MS;
}

async function postIfDue(client, guild, now = Date.now()) {
  const cfg = stats.getConfig(guild.id);
  if (!isDue(cfg, now)) return false;
  const channel = guild.channels.cache.get(cfg.channelId);
  const me = guild.members.me;
  if (!channel?.isTextBased?.() || !me || !channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) return false;
  await channel.send({ embeds: [embedForGuild(client, guild, now)], allowedMentions: NO_PINGS });
  stats.setConfig(guild.id, { lastPostAt: now });
  return true;
}

async function sweep(client) {
  try { stats.prune(); } catch (err) { log.error('healthpost prune failed:', err?.message || err); }
  for (const guild of client.guilds.cache.values()) {
    try { await postIfDue(client, guild); } catch (err) { log.error(`healthpost failed for ${guild.id}:`, err?.message || err); }
  }
}

function startSweep(client) {
  setTimeout(() => sweep(client), 60 * 1000).unref?.();
  setInterval(() => sweep(client), SWEEP_MS).unref?.();
}

module.exports = { visibleTextChannels, buildForGuild, embedForGuild, isDue, postIfDue, sweep, startSweep };
