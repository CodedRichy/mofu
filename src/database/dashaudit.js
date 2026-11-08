// Dashboard audit trail: who changed which setting through the web dashboard, and when.
// Only changes made via the dashboard are recorded (not bot commands). Detail holds KEY NAMES only (plus
// booleans), never values, tokens or message text. The table carries guild_id, so the 30-day
// guild-departure purge in retention.js covers it; rows also expire after 90 days on their own.
// create(db) builds the API on any better-sqlite3 handle (tests pass ':memory:'); module-level functions
// use the bot's shared database, opened lazily.

const DETAIL_MAX = 200;
const USERNAME_MAX = 64;
const ACTION_MAX = 48;
const MAX_AGE_MS = 90 * 86400000;
const PURGE_EVERY_MS = 3600000;

function clip(value, max) {
  const s = String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

function create(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dashboard_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dashboard_audit_guild ON dashboard_audit(guild_id, id DESC);
  `);

  const stmts = {
    insert: db.prepare('INSERT INTO dashboard_audit (guild_id, user_id, username, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    list: db.prepare('SELECT id, user_id, username, action, detail, created_at FROM dashboard_audit WHERE guild_id = ? ORDER BY id DESC LIMIT ? OFFSET ?'),
    count: db.prepare('SELECT COUNT(*) AS n FROM dashboard_audit WHERE guild_id = ?'),
    purge: db.prepare('DELETE FROM dashboard_audit WHERE created_at < ?'),
  };
  let lastPurge = 0;

  const api = {
    DETAIL_MAX,

    record({ guildId, userId, username, action, detail }, now = Date.now()) {
      if (!guildId || !userId || !action) return false;
      stmts.insert.run(String(guildId), String(userId), clip(username, USERNAME_MAX) || null, clip(action, ACTION_MAX), clip(detail, DETAIL_MAX) || null, now);
      if (now - lastPurge > PURGE_EVERY_MS) { lastPurge = now; api.purge(now); }
      return true;
    },

    list(guildId, { limit = 25, offset = 0 } = {}) {
      const lim = Math.min(Math.max(Math.trunc(Number(limit)) || 25, 1), 50);
      const off = Math.max(Math.trunc(Number(offset)) || 0, 0);
      return stmts.list.all(String(guildId), lim, off);
    },

    count(guildId) { return stmts.count.get(String(guildId)).n; },

    // Delete rows older than 90 days (all guilds). Returns rows removed.
    purge(now = Date.now()) { return stmts.purge.run(now - MAX_AGE_MS).changes; },
  };
  return api;
}

let shared = null;
function api() {
  if (!shared) shared = create(require('./store').db);
  return shared;
}

module.exports = {
  create,
  DETAIL_MAX,
  record: (...a) => api().record(...a),
  list: (...a) => api().list(...a),
  count: (...a) => api().count(...a),
  purge: (...a) => api().purge(...a),
};
