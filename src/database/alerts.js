// Alert subscriptions (YouTube uploads, RSS/Atom feeds). The table carries guild_id, so the 30-day retention purge
// covers it. Stores hashed entry ids only. create(db) builds the API on any better-sqlite3 handle (tests pass
// ':memory:'); the module-level functions use the bot's database, opened lazily.

function create(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS alert_subs (
      guild_id TEXT NOT NULL,
      sub_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      feed_url TEXT NOT NULL,
      label TEXT,
      channel_id TEXT NOT NULL,
      added_by TEXT,
      seen TEXT NOT NULL DEFAULT '[]',
      fails INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      next_check INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, sub_id)
    );
    CREATE INDEX IF NOT EXISTS idx_alert_subs_due ON alert_subs(enabled, next_check);
  `);

  const map = (r) => r && ({
    guildId: r.guild_id, id: r.sub_id, kind: r.kind, feedUrl: r.feed_url, label: r.label || '', channelId: r.channel_id,
    addedBy: r.added_by, seen: JSON.parse(r.seen || '[]'), fails: r.fails, lastError: r.last_error || '',
    enabled: !!r.enabled, nextCheck: r.next_check, createdAt: r.created_at,
  });

  const stmts = {
    count: db.prepare('SELECT COUNT(*) AS n FROM alert_subs WHERE guild_id = ?'),
    dup: db.prepare('SELECT 1 FROM alert_subs WHERE guild_id = ? AND feed_url = ? AND channel_id = ?'),
    maxId: db.prepare('SELECT MAX(sub_id) AS m FROM alert_subs WHERE guild_id = ?'),
    insert: db.prepare('INSERT INTO alert_subs (guild_id, sub_id, kind, feed_url, label, channel_id, added_by, seen, next_check, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    get: db.prepare('SELECT * FROM alert_subs WHERE guild_id = ? AND sub_id = ?'),
    list: db.prepare('SELECT * FROM alert_subs WHERE guild_id = ? ORDER BY sub_id'),
    remove: db.prepare('DELETE FROM alert_subs WHERE guild_id = ? AND sub_id = ?'),
    due: db.prepare('SELECT * FROM alert_subs WHERE enabled = 1 AND next_check <= ? ORDER BY next_check LIMIT ?'),
    ok: db.prepare('UPDATE alert_subs SET seen = ?, fails = 0, last_error = NULL, next_check = ?, label = COALESCE(NULLIF(label, \'\'), ?) WHERE guild_id = ? AND sub_id = ?'),
    fail: db.prepare('UPDATE alert_subs SET fails = ?, last_error = ?, next_check = ?, enabled = ? WHERE guild_id = ? AND sub_id = ?'),
  };

  return {
    count(guildId) { return stmts.count.get(String(guildId)).n; },

    // sub: { kind, feedUrl, label, channelId, addedBy, seen:[hash], now }. The limit is checked inside the same
    // transaction as the insert. Returns { ok:true, id } or { ok:false, reason:'limit'|'duplicate' }.
    add(guildId, sub, max) {
      const gid = String(guildId);
      return db.transaction(() => {
        if (stmts.count.get(gid).n >= max) return { ok: false, reason: 'limit' };
        if (stmts.dup.get(gid, sub.feedUrl, sub.channelId)) return { ok: false, reason: 'duplicate' };
        const id = (stmts.maxId.get(gid).m || 0) + 1;
        const now = sub.now ?? Date.now();
        stmts.insert.run(gid, id, sub.kind, sub.feedUrl, sub.label || '', sub.channelId, sub.addedBy || null, JSON.stringify(sub.seen || []), now, now);
        return { ok: true, id };
      })();
    },

    get(guildId, id) { return map(stmts.get.get(String(guildId), Number(id))); },
    list(guildId) { return stmts.list.all(String(guildId)).map(map); },
    remove(guildId, id) { return stmts.remove.run(String(guildId), Number(id)).changes > 0; },
    due(now, limit = 200) { return stmts.due.all(now, limit).map(map); },

    recordSuccess(guildId, id, { seen, nextCheck, label }) {
      stmts.ok.run(JSON.stringify(seen), nextCheck, label || '', String(guildId), Number(id));
    },
    recordFailure(guildId, id, { fails, nextCheck, disable, error }) {
      stmts.fail.run(fails, String(error || '').slice(0, 120), nextCheck, disable ? 0 : 1, String(guildId), Number(id));
    },
  };
}

let shared = null;
function api() {
  if (!shared) shared = create(require('./store').db);
  return shared;
}

const methods = ['count', 'add', 'get', 'list', 'remove', 'due', 'recordSuccess', 'recordFailure'];
const lazy = {};
for (const m of methods) lazy[m] = (...args) => api()[m](...args);

module.exports = { create, ...lazy };
