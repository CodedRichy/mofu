const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', '..', 'data', 'sonder.db');
require('fs').mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    message TEXT NOT NULL,
    remind_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reminders_time ON reminders(remind_at);
`);

const stmts = {
  add: db.prepare('INSERT INTO reminders (guild_id, channel_id, user_id, message, remind_at, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  remove: db.prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?'),
  removeById: db.prepare('DELETE FROM reminders WHERE id = ?'),
  list: db.prepare('SELECT id, message, remind_at as expiresAt FROM reminders WHERE user_id = ? ORDER BY remind_at ASC'),
  getDue: db.prepare('SELECT * FROM reminders WHERE remind_at <= ?'),
};

// In-memory callback registry for active reminders in this session
const callbacks = new Map();

module.exports = {
  add(userId, channelId, message, duration, guildId = '') {
    const now = Date.now();
    const expiresAt = now + duration;
    const info = stmts.add.run(guildId, channelId, userId, message, expiresAt, now);
    const id = Number(info.lastInsertRowid);

    const timeout = setTimeout(() => {
      const cb = callbacks.get(id);
      if (cb) cb();
      callbacks.delete(id);
      callbacks.delete(`_timeout_${id}`);
      // Remove from DB after firing
      stmts.removeById.run(id);
    }, duration);

    // Store timeout reference so we can cancel it
    callbacks.set(id, null);
    callbacks.set(`_timeout_${id}`, timeout);

    return { id, expiresAt };
  },

  setCallback(id, callback) {
    callbacks.set(id, callback);
  },

  remove(id, userId) {
    const info = stmts.remove.run(id, userId);
    if (info.changes === 0) return false;
    // Clear the in-memory timeout if it exists
    const timeout = callbacks.get(`_timeout_${id}`);
    if (timeout) clearTimeout(timeout);
    callbacks.delete(id);
    callbacks.delete(`_timeout_${id}`);
    return true;
  },

  list(userId) {
    return stmts.list.all(userId).map((r) => ({ id: r.id, message: r.message, expiresAt: r.expiresAt }));
  },

  getDueReminders() {
    return stmts.getDue.all(Date.now()).map((r) => ({
      id: r.id,
      guildId: r.guild_id,
      channelId: r.channel_id,
      userId: r.user_id,
      message: r.message,
      remindAt: r.remind_at,
      createdAt: r.created_at,
    }));
  },

  removeReminder(id) {
    const info = stmts.removeById.run(id);
    const timeout = callbacks.get(`_timeout_${id}`);
    if (timeout) clearTimeout(timeout);
    callbacks.delete(id);
    callbacks.delete(`_timeout_${id}`);
    return info.changes > 0;
  },
};
