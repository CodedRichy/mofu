// Single source of truth for the server log: which events are logged to the log channel, and which
// config key toggles each one. Every logger (events/messageDelete, messageUpdate, auditLog, voiceStateUpdate)
// reads the channel and the toggle through here, and /logging builds its replies from EVENTS.
const store = require('../database/store');

// key = config key flipped by /logging toggle; label = shown to admins.
const EVENTS = [
  { key: 'log_message_delete', label: 'Message deletes' },
  { key: 'log_message_edit', label: 'Message edits' },
  { key: 'log_voice', label: 'Voice joins, leaves and moves' },
  { key: 'log_role_change', label: 'Member role changes' },
  { key: 'log_nickname', label: 'Nickname changes' },
  { key: 'log_channels', label: 'Channel created or deleted' },
  { key: 'log_roles_manage', label: 'Role created or deleted' },
  { key: 'log_bans', label: 'Bans and unbans' },
];

const KEYS = EVENTS.map((e) => e.key);

// Not logged to the log channel by any of the loggers above.
const NOT_LOGGED = 'Member joins and leaves';

function isEnabled(guildId, key) {
  return store.getConfig(guildId, key) !== false;
}

function channelId(guildId) {
  // The dashboard and /logging historically used different keys; honour either.
  return store.getConfig(guildId, 'log_channel') || store.getConfig(guildId, 'logging_channel') || null;
}

// Returns the log channel for an event, or null when logging is off for that event or no channel is set.
function resolve(guild, key) {
  if (!guild || !isEnabled(guild.id, key)) return null;
  const id = channelId(guild.id);
  if (!id) return null;
  return guild.channels.cache.get(id) || null;
}

function label(key) {
  const e = EVENTS.find((x) => x.key === key);
  return e ? e.label : key.replace(/^log_/, '').replace(/_/g, ' ');
}

function stateLines(guildId) {
  return EVENTS.map((e) => `${isEnabled(guildId, e.key) ? 'On ' : 'Off'}  ${e.label}`);
}

module.exports = { EVENTS, KEYS, NOT_LOGGED, isEnabled, channelId, resolve, label, stateLines };
