// Role panels (button / select / reaction) and their entries. Both tables carry guild_id, so the 30-day
// retention purge covers them automatically. create(db) builds the API on any better-sqlite3 handle (tests pass
// ':memory:'); module-level functions use the bot's shared database, opened lazily on first call.
//
// Button custom ids are `rp:<panel>:<role>` and select ids `rp:<panel>`: the click names the panel, the row here
// says what it does. Nothing lives in memory, so panels keep working across restarts.

function create(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS role_panels (
      guild_id TEXT NOT NULL,
      panel_id INTEGER NOT NULL,
      channel_id TEXT,
      message_id TEXT,
      type TEXT NOT NULL DEFAULT 'button',
      mode TEXT NOT NULL DEFAULT 'normal',
      title TEXT NOT NULL,
      description TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      PRIMARY KEY (guild_id, panel_id)
    );
    CREATE INDEX IF NOT EXISTS idx_role_panels_message ON role_panels(message_id);
    CREATE TABLE IF NOT EXISTS role_panel_entries (
      guild_id TEXT NOT NULL,
      panel_id INTEGER NOT NULL,
      role_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      label TEXT,
      emoji TEXT,
      emoji_key TEXT,
      description TEXT,
      danger_ok TEXT,
      PRIMARY KEY (guild_id, panel_id, role_id)
    );
  `);

  const s = {
    maxPanel: db.prepare('SELECT MAX(panel_id) AS m FROM role_panels WHERE guild_id = ?'),
    countPanels: db.prepare('SELECT COUNT(*) AS n FROM role_panels WHERE guild_id = ?'),
    insertPanel: db.prepare(`INSERT INTO role_panels (guild_id, panel_id, channel_id, type, mode, title, description, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    getPanel: db.prepare('SELECT * FROM role_panels WHERE guild_id = ? AND panel_id = ?'),
    byMessage: db.prepare('SELECT * FROM role_panels WHERE message_id = ?'),
    listPanels: db.prepare('SELECT * FROM role_panels WHERE guild_id = ? ORDER BY panel_id ASC'),
    setMessage: db.prepare('UPDATE role_panels SET channel_id = ?, message_id = ?, updated_at = ? WHERE guild_id = ? AND panel_id = ?'),
    deletePanel: db.prepare('DELETE FROM role_panels WHERE guild_id = ? AND panel_id = ?'),
    deleteEntries: db.prepare('DELETE FROM role_panel_entries WHERE guild_id = ? AND panel_id = ?'),
    entries: db.prepare('SELECT * FROM role_panel_entries WHERE guild_id = ? AND panel_id = ? ORDER BY position ASC'),
    maxPos: db.prepare('SELECT MAX(position) AS m FROM role_panel_entries WHERE guild_id = ? AND panel_id = ?'),
    insertEntry: db.prepare(`INSERT INTO role_panel_entries (guild_id, panel_id, role_id, position, label, emoji, emoji_key, description, danger_ok)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    updateEntry: db.prepare(`UPDATE role_panel_entries SET label = ?, emoji = ?, emoji_key = ?, description = ?, danger_ok = ?
      WHERE guild_id = ? AND panel_id = ? AND role_id = ?`),
    removeEntry: db.prepare('DELETE FROM role_panel_entries WHERE guild_id = ? AND panel_id = ? AND role_id = ?'),
    touch: db.prepare('UPDATE role_panels SET updated_at = ? WHERE guild_id = ? AND panel_id = ?'),
  };

  const entryRow = (guildId, panelId, pos, e) => [
    String(guildId), panelId, String(e.roleId), pos, e.label ?? null,
    e.emoji ? JSON.stringify(e.emoji) : null, e.emojiKey ?? null, e.description ?? null, e.dangerOk ?? null,
  ];

  // Number allocation under an IMMEDIATE transaction (same reasoning as mod cases: shards share the file).
  const createTx = db.transaction((p) => {
    const id = (s.maxPanel.get(p.guildId).m || 0) + 1;
    s.insertPanel.run(p.guildId, id, p.channelId ?? null, p.type, p.mode, p.title, p.description ?? null, p.createdBy ?? null, p.now);
    (p.entries || []).forEach((e, i) => s.insertEntry.run(...entryRow(p.guildId, id, i + 1, e)));
    return id;
  });

  const withEntries = (panel) => (panel ? { ...panel, entries: s.entries.all(panel.guild_id, panel.panel_id) } : null);

  return {
    createPanel({ guildId, channelId = null, type = 'button', mode = 'normal', title, description = null, createdBy = null, entries = [], now = Date.now() }) {
      if (!guildId || !title) throw new Error('createPanel needs guildId and title');
      return createTx.immediate({ guildId: String(guildId), channelId, type, mode, title, description, createdBy, entries, now });
    },

    // Read-only export for /backup: definitions only (no message, channel or creator ids).
    exportPanels(guildId) {
      return s.listPanels.all(String(guildId)).map((p) => ({
        panelId: p.panel_id, type: p.type, mode: p.mode, title: p.title, description: p.description,
        entries: s.entries.all(p.guild_id, p.panel_id).map((e) => ({
          roleId: e.role_id, position: e.position, label: e.label, emoji: e.emoji, emojiKey: e.emoji_key,
          description: e.description, dangerOk: e.danger_ok,
        })),
      }));
    },

    countPanels(guildId) {
      return s.countPanels.get(String(guildId)).n;
    },

    getPanel(guildId, panelId) {
      return withEntries(s.getPanel.get(String(guildId), Number(panelId)));
    },

    panelByMessage(messageId) {
      return withEntries(s.byMessage.get(String(messageId)));
    },

    listPanels(guildId) {
      return s.listPanels.all(String(guildId)).map(withEntries);
    },

    setMessage(guildId, panelId, channelId, messageId, now = Date.now()) {
      return s.setMessage.run(channelId, messageId, now, String(guildId), Number(panelId)).changes > 0;
    },

    // fields: any of title, description, mode, type. Unknown keys are ignored (fixed column list, no SQL from input).
    updatePanel(guildId, panelId, fields, now = Date.now()) {
      const cols = ['title', 'description', 'mode', 'type'].filter((c) => fields[c] !== undefined);
      if (!cols.length) return false;
      const sql = `UPDATE role_panels SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE guild_id = ? AND panel_id = ?`;
      return db.prepare(sql).run(...cols.map((c) => fields[c]), now, String(guildId), Number(panelId)).changes > 0;
    },

    deletePanel: db.transaction((guildId, panelId) => {
      s.deleteEntries.run(String(guildId), Number(panelId));
      return s.deletePanel.run(String(guildId), Number(panelId)).changes > 0;
    }),

    // Adds, or updates in place when the role is already on the panel. Returns 'added' | 'updated'.
    upsertEntry(guildId, panelId, e, now = Date.now()) {
      const g = String(guildId);
      const p = Number(panelId);
      const exists = s.entries.all(g, p).some((r) => r.role_id === String(e.roleId));
      if (exists) {
        s.updateEntry.run(e.label ?? null, e.emoji ? JSON.stringify(e.emoji) : null, e.emojiKey ?? null, e.description ?? null, e.dangerOk ?? null, g, p, String(e.roleId));
      } else {
        s.insertEntry.run(...entryRow(g, p, (s.maxPos.get(g, p).m || 0) + 1, e));
      }
      s.touch.run(now, g, p);
      return exists ? 'updated' : 'added';
    },

    removeEntry(guildId, panelId, roleId, now = Date.now()) {
      const ok = s.removeEntry.run(String(guildId), Number(panelId), String(roleId)).changes > 0;
      if (ok) s.touch.run(now, String(guildId), Number(panelId));
      return ok;
    },
  };
}

let shared = null;
function api() {
  if (!shared) shared = create(require('./store').db);
  return shared;
}

const methods = ['createPanel', 'exportPanels', 'countPanels', 'getPanel', 'panelByMessage', 'listPanels', 'setMessage',
  'updatePanel', 'deletePanel', 'upsertEntry', 'removeEntry'];
const lazy = {};
for (const m of methods) lazy[m] = (...args) => api()[m](...args);

module.exports = { create, ...lazy };
