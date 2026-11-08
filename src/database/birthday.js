const Database = require('better-sqlite3');
const path = require('path');
const store = require('./store');

const dbPath = path.join(__dirname, '..', '..', 'data', 'sonder.db');
require('fs').mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS birthdays (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    month INTEGER NOT NULL,
    day INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );
`);

const stmts = {
  set: db.prepare('INSERT OR REPLACE INTO birthdays (guild_id, user_id, month, day) VALUES (?, ?, ?, ?)'),
  get: db.prepare('SELECT month, day FROM birthdays WHERE guild_id = ? AND user_id = ?'),
  remove: db.prepare('DELETE FROM birthdays WHERE guild_id = ? AND user_id = ?'),
  getToday: db.prepare('SELECT user_id FROM birthdays WHERE guild_id = ? AND month = ? AND day = ?'),
  listAll: db.prepare('SELECT user_id, month, day FROM birthdays WHERE guild_id = ?'),
};

module.exports = {
  setBirthday(guildId, userId, month, day) {
    stmts.set.run(guildId, userId, month, day);
  },

  getBirthday(guildId, userId) {
    const row = stmts.get.get(guildId, userId);
    return row ? { month: row.month, day: row.day } : null;
  },

  removeBirthday(guildId, userId) {
    stmts.remove.run(guildId, userId);
  },

  getChannel(guildId) {
    return store.getConfig(guildId, 'birthday_channel');
  },

  setChannel(guildId, channelId) {
    store.setConfig(guildId, 'birthday_channel', channelId);
  },

  getTodayBirthdays(guildId) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    return stmts.getToday.all(guildId, month, day).map((r) => r.user_id);
  },

  getOn(guildId, month, day) {
    return stmts.getToday.all(guildId, month, day).map((r) => r.user_id);
  },

  listAll(guildId) {
    return stmts.listAll.all(guildId).map((r) => ({ userId: r.user_id, month: r.month, day: r.day }));
  },
};
