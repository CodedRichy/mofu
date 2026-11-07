// Data retention: when mofu is removed from a server its data is kept for RETENTION_DAYS (in case the
// removal was an accident), then deleted from every table that has a guild_id column. Re-adding the bot
// inside the window cancels the deletion. This is what the privacy policy promises.
const store = require('./store');
const { db } = store;
const log = require('../utils/logger');
const { scrubAiPrompts } = require('./privacy');

const RETENTION_DAYS = 30;
const DAY_MS = 86400000;

db.exec(`
  CREATE TABLE IF NOT EXISTS guild_departures (
    guild_id TEXT PRIMARY KEY,
    left_at INTEGER NOT NULL
  )
`);

const stmts = {
  mark: db.prepare('INSERT OR REPLACE INTO guild_departures (guild_id, left_at) VALUES (?, ?)'),
  unmark: db.prepare('DELETE FROM guild_departures WHERE guild_id = ?'),
  due: db.prepare('SELECT guild_id FROM guild_departures WHERE left_at <= ?'),
};

function markLeft(guildId) { stmts.mark.run(guildId, Date.now()); }
function markReturned(guildId) { stmts.unmark.run(guildId); }

// Every table with a guild_id column, discovered from the schema so new tables are covered automatically.
function guildTables() {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()
    .map((t) => t.name)
    .filter((name) => name !== 'guild_departures')
    .filter((name) => db.prepare(`PRAGMA table_info("${name}")`).all().some((c) => c.name === 'guild_id'));
}

// Delete everything stored for one guild. Returns total rows removed.
function purgeGuild(guildId) {
  const tables = guildTables();
  let removed = 0;
  db.transaction(() => {
    for (const name of tables) removed += db.prepare(`DELETE FROM "${name}" WHERE guild_id = ?`).run(guildId).changes;
    stmts.unmark.run(guildId);
  })();
  store.clearConfigCache(guildId);
  return removed;
}

function sweep(client) {
  // AI action audit rows stay, but the chat text that triggered them goes after RETENTION_DAYS.
  try {
    const scrubbed = scrubAiPrompts(db, { maxAgeMs: RETENTION_DAYS * DAY_MS });
    if (scrubbed) log.info(`Retention: cleared prompt text from ${scrubbed} AI action rows older than ${RETENTION_DAYS} days`);
  } catch (err) {
    log.warn(`Retention: AI prompt scrub failed: ${err.message}`);
  }
  const cutoff = Date.now() - RETENTION_DAYS * DAY_MS;
  for (const { guild_id: guildId } of stmts.due.all(cutoff)) {
    if (client.guilds.cache.has(guildId)) { markReturned(guildId); continue; } // came back without an event
    const removed = purgeGuild(guildId);
    log.info(`Retention: purged ${removed} rows for guild ${guildId} (left > ${RETENTION_DAYS} days ago)`);
  }
}

module.exports = { markLeft, markReturned, purgeGuild, sweep, guildTables, RETENTION_DAYS };
