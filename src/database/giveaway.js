const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', '..', 'data', 'sonder.db');
require('fs').mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS giveaways (
    guild_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    host_id TEXT NOT NULL,
    prize TEXT NOT NULL,
    winners INTEGER DEFAULT 1,
    ends_at INTEGER NOT NULL,
    ended INTEGER DEFAULT 0,
    entries TEXT DEFAULT '[]',
    PRIMARY KEY (guild_id, message_id)
  );
  CREATE INDEX IF NOT EXISTS idx_giveaways_guild ON giveaways(guild_id);
`);

const stmts = {
  create: db.prepare('INSERT OR REPLACE INTO giveaways (guild_id, message_id, channel_id, host_id, prize, winners, ends_at, ended, entries) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)'),
  get: db.prepare('SELECT * FROM giveaways WHERE guild_id = ? AND message_id = ?'),
  update: db.prepare('UPDATE giveaways SET entries = ?, ended = ? WHERE guild_id = ? AND message_id = ?'),
  getActive: db.prepare('SELECT * FROM giveaways WHERE guild_id = ? AND ended = 0'),
  getAllActive: db.prepare('SELECT * FROM giveaways WHERE ended = 0'),
  remove: db.prepare('DELETE FROM giveaways WHERE guild_id = ? AND message_id = ?'),
};

function parseGiveaway(row) {
  if (!row) return null;
  const entries = new Set(JSON.parse(row.entries));
  return {
    guildId: row.guild_id,
    messageId: row.message_id,
    channelId: row.channel_id,
    hostId: row.host_id,
    prize: row.prize,
    winnerCount: row.winners,
    endsAt: row.ends_at,
    ended: !!row.ended,
    entries,
  };
}

module.exports = {
  create(guildId, data) {
    stmts.create.run(guildId, data.messageId, data.channelId, data.hostId, data.prize, data.winnerCount || 1, data.endsAt, JSON.stringify([]));
    return `${guildId}:${data.messageId}`;
  },

  get(guildId, messageId) {
    return parseGiveaway(stmts.get.get(guildId, messageId));
  },

  addEntry(guildId, messageId, userId) {
    const gw = this.get(guildId, messageId);
    if (!gw || gw.ended) return false;
    gw.entries.add(userId);
    stmts.update.run(JSON.stringify([...gw.entries]), 0, guildId, messageId);
    return true;
  },

  removeEntry(guildId, messageId, userId) {
    const gw = this.get(guildId, messageId);
    if (!gw) return;
    gw.entries.delete(userId);
    stmts.update.run(JSON.stringify([...gw.entries]), gw.ended ? 1 : 0, guildId, messageId);
  },

  end(guildId, messageId) {
    const gw = this.get(guildId, messageId);
    if (!gw || gw.ended) return null; // already ended (manual end + timer): announce only once
    gw.ended = true;
    stmts.update.run(JSON.stringify([...gw.entries]), 1, guildId, messageId);
    return gw;
  },

  // Undo end() when the announcement could not be made (e.g. guild not cached yet).
  reopen(guildId, messageId) {
    const gw = this.get(guildId, messageId);
    if (!gw) return false;
    stmts.update.run(JSON.stringify([...gw.entries]), 0, guildId, messageId);
    return true;
  },

  pickWinners(gw, count) {
    const entries = [...gw.entries].filter((id) => id !== gw.hostId);
    const winners = [];
    const pool = [...entries];
    for (let i = 0; i < Math.min(count, pool.length); i++) {
      const idx = Math.floor(Math.random() * pool.length);
      winners.push(pool.splice(idx, 1)[0]);
    }
    return winners;
  },

  getActive(guildId) {
    return stmts.getActive.all(guildId).map(parseGiveaway);
  },

  getAllActive() {
    return stmts.getAllActive.all().map(parseGiveaway);
  },

  remove(guildId, messageId) {
    stmts.remove.run(guildId, messageId);
  },
};
