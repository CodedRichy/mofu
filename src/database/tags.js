// Tags (per-server saved responses). The table carries guild_id, so the 30-day retention purge covers it.
// create(db) builds the API on any better-sqlite3 handle (tests pass ':memory:'); module-level functions use the
// bot's shared database, opened lazily on first call.

const { LIMITS } = require('../utils/tags');

function create(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      embed INTEGER NOT NULL DEFAULT 0,
      owner_id TEXT,
      uses INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      updated_by TEXT,
      PRIMARY KEY (guild_id, name)
    );
  `);

  const s = {
    count: db.prepare('SELECT COUNT(*) AS n FROM tags WHERE guild_id = ?'),
    get: db.prepare('SELECT * FROM tags WHERE guild_id = ? AND name = ?'),
    insert: db.prepare('INSERT INTO tags (guild_id, name, content, embed, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    update: db.prepare('UPDATE tags SET content = ?, embed = ?, updated_at = ?, updated_by = ? WHERE guild_id = ? AND name = ?'),
    remove: db.prepare('DELETE FROM tags WHERE guild_id = ? AND name = ?'),
    list: db.prepare('SELECT name, uses, embed FROM tags WHERE guild_id = ? ORDER BY name ASC'),
    search: db.prepare("SELECT name FROM tags WHERE guild_id = ? AND name LIKE ? ESCAPE '\\' ORDER BY uses DESC, name ASC LIMIT ?"),
    bump: db.prepare('UPDATE tags SET uses = uses + 1 WHERE guild_id = ? AND name = ?'),
  };

  // Count + insert under one IMMEDIATE transaction so the per-server cap holds even with two shards writing.
  const createTx = db.transaction((g, name, content, embed, ownerId, now, cap) => {
    if (s.get.get(g, name)) return 'exists';
    if (s.count.get(g).n >= cap) return 'cap';
    s.insert.run(g, name, content, embed ? 1 : 0, ownerId, now);
    return 'ok';
  });

  return {
    // Returns 'ok' | 'exists' | 'cap'. Name and content must already be validated (src/utils/tags.js).
    createTag(guildId, { name, content, embed = false, ownerId = null, now = Date.now(), cap = LIMITS.perGuild }) {
      return createTx.immediate(String(guildId), name, content, embed, ownerId, now, cap);
    },
    getTag(guildId, name) {
      const row = s.get.get(String(guildId), String(name));
      return row ? { ...row, embed: !!row.embed } : null;
    },
    // embed undefined keeps the current setting. Returns false when the tag does not exist.
    updateTag(guildId, name, { content, embed, by = null, now = Date.now() }) {
      const cur = this.getTag(guildId, name);
      if (!cur) return false;
      return s.update.run(content ?? cur.content, (embed ?? cur.embed) ? 1 : 0, now, by, String(guildId), String(name)).changes > 0;
    },
    deleteTag(guildId, name) {
      return s.remove.run(String(guildId), String(name)).changes > 0;
    },
    listTags(guildId) {
      return s.list.all(String(guildId));
    },
    // Read-only export for /backup: saved responses (server config), no owner ids.
    exportTags(guildId) {
      return db.prepare('SELECT name, content, embed, uses FROM tags WHERE guild_id = ? ORDER BY name ASC')
        .all(String(guildId)).map((r) => ({ ...r, embed: !!r.embed }));
    },
    countTags(guildId) {
      return s.count.get(String(guildId)).n;
    },
    searchTags(guildId, prefix, limit = 25) {
      const like = `${String(prefix).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      return s.search.all(String(guildId), like, limit).map((r) => r.name);
    },
    bumpUses(guildId, name) {
      return s.bump.run(String(guildId), String(name)).changes > 0;
    },
  };
}

let shared = null;
function api() {
  if (!shared) shared = create(require('./store').db);
  return shared;
}

const methods = ['createTag', 'getTag', 'updateTag', 'deleteTag', 'listTags', 'exportTags', 'countTags', 'searchTags', 'bumpUses'];
const lazy = {};
for (const m of methods) lazy[m] = (...args) => api()[m](...args);

module.exports = { create, ...lazy };
