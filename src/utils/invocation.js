// How a member actually runs a command in a given server. Prefix-only commands have no slash form, so
// pointing people at `/name` for them is a lie. Derived at runtime from PREFIX_ONLY (commandHandler.js),
// so it stays right when commands move between slash and prefix-only.
const config = require('../config');
const store = require('../database/store');

function prefixFor(guildId) {
  return (guildId && store.getConfig(guildId, 'prefix')) || config.discord.defaultPrefix;
}

function isSlash(name) {
  // Lazy require: commandHandler is loaded after the command files that call this.
  const { PREFIX_ONLY } = require('../handlers/commandHandler');
  return !PREFIX_ONLY.has(String(name).toLowerCase());
}

// cmdRef(guildId, 'backup export') -> "`;backup export`" or "`/backup export`" (backticks included).
function cmdRef(guildId, usage) {
  const text = String(usage).trim();
  const name = text.split(/\s+/)[0];
  return isSlash(name) ? `\`/${text}\`` : `\`${prefixFor(guildId)}${text}\``;
}

module.exports = { cmdRef, isSlash, prefixFor };
