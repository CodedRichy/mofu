// Disboard bump reminder that survives a restart: the due time is saved per guild (config key bump_due) and the
// timers are rebuilt on ready. One timer per guild; a new bump replaces the old one.
const store = require('../database/store');
const log = require('./logger');

const BUMP_MS = 7200000;
const timers = new Map(); // guildId -> Timeout

function fire(client, guildId) {
  timers.delete(guildId);
  try {
    store.setConfig(guildId, 'bump_due', null); // cleared first so a crash in send cannot double-remind
    const channelId = store.getConfig(guildId, 'bump_channel');
    const ch = channelId && client.guilds.cache.get(guildId)?.channels.cache.get(channelId);
    if (!ch) return;
    const { response } = require('./embed');
    const { colors } = require('./constants');
    ch.send({ embeds: [response({ client, description: 'Time to bump! Use `/bump` to bump the server.', color: colors.primary })] }).catch(() => {});
  } catch (err) {
    log.warn('bump reminder failed:', err.message);
  }
}

function schedule(client, guildId, dueAt) {
  clearTimeout(timers.get(guildId));
  const t = setTimeout(() => fire(client, guildId), Math.max(0, Math.min(dueAt - Date.now(), BUMP_MS)));
  t.unref?.();
  timers.set(guildId, t);
}

// A bump was just confirmed in this guild.
function onBump(client, guildId) {
  if (!store.getConfig(guildId, 'bump_channel')) return;
  const dueAt = Date.now() + BUMP_MS;
  store.setConfig(guildId, 'bump_due', dueAt);
  schedule(client, guildId, dueAt);
}

// On ready: re-arm every saved reminder (overdue ones fire right away).
function restore(client) {
  let n = 0;
  for (const guildId of client.guilds.cache.keys()) {
    const due = Number(store.getConfig(guildId, 'bump_due'));
    if (due > 0) { schedule(client, guildId, due); n++; }
  }
  if (n) log.info(`Restored ${n} bump reminder(s)`);
}

module.exports = { onBump, restore, BUMP_MS };
