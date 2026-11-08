const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', '..', 'data', 'sonder.db');
require('fs').mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    guild_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    PRIMARY KEY (guild_id, key)
  );
  CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    moderator TEXT,
    reason TEXT,
    timestamp TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_warnings_guild_user ON warnings(guild_id, user_id);
  CREATE TABLE IF NOT EXISTS economy (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    wallet INTEGER DEFAULT 0,
    bank INTEGER DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS cooldowns (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, key)
  );
  CREATE TABLE IF NOT EXISTS custom_commands (
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    response TEXT NOT NULL,
    embed INTEGER DEFAULT 0,
    PRIMARY KEY (guild_id, name)
  );
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    moderator TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notes_guild_user ON notes(guild_id, user_id);
`);

const stmts = {
  getConfig: db.prepare('SELECT value FROM config WHERE guild_id = ? AND key = ?'),
  setConfig: db.prepare('INSERT OR REPLACE INTO config (guild_id, key, value) VALUES (?, ?, ?)'),
  deleteConfig: db.prepare('DELETE FROM config WHERE guild_id = ? AND key = ?'),

  addWarning: db.prepare('INSERT INTO warnings (guild_id, user_id, moderator, reason, timestamp) VALUES (?, ?, ?, ?, ?)'),
  getWarnings: db.prepare('SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY id DESC'),
  removeWarning: db.prepare('DELETE FROM warnings WHERE id = ? AND guild_id = ? AND user_id = ?'),
  clearWarnings: db.prepare('DELETE FROM warnings WHERE guild_id = ? AND user_id = ?'),
  countWarnings: db.prepare('SELECT COUNT(*) as count FROM warnings WHERE guild_id = ? AND user_id = ?'),

  getEconomy: db.prepare('SELECT wallet, bank FROM economy WHERE guild_id = ? AND user_id = ?'),
  upsertEconomy: db.prepare('INSERT INTO economy (guild_id, user_id, wallet, bank) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET wallet = ?, bank = ?'),
  getLeaderboard: db.prepare('SELECT user_id, (wallet + bank) as total FROM economy WHERE guild_id = ? ORDER BY total DESC LIMIT ?'),

  setCooldown: db.prepare('INSERT OR REPLACE INTO cooldowns (guild_id, user_id, key, expires_at) VALUES (?, ?, ?, ?)'),
  getCooldown: db.prepare('SELECT expires_at FROM cooldowns WHERE guild_id = ? AND user_id = ? AND key = ?'),
  deleteCooldown: db.prepare('DELETE FROM cooldowns WHERE guild_id = ? AND user_id = ? AND key = ?'),

  addCustomCmd: db.prepare('INSERT OR REPLACE INTO custom_commands (guild_id, name, response, embed) VALUES (?, ?, ?, ?)'),
  removeCustomCmd: db.prepare('DELETE FROM custom_commands WHERE guild_id = ? AND name = ?'),
  getCustomCmd: db.prepare('SELECT response, embed FROM custom_commands WHERE guild_id = ? AND name = ?'),
  listCustomCmds: db.prepare('SELECT name, response, embed FROM custom_commands WHERE guild_id = ?'),

  addNote: db.prepare('INSERT INTO notes (guild_id, user_id, moderator, content, timestamp) VALUES (?, ?, ?, ?, ?)'),
  getNotes: db.prepare('SELECT * FROM notes WHERE guild_id = ? AND user_id = ? ORDER BY id DESC'),
  removeNote: db.prepare('DELETE FROM notes WHERE id = ? AND guild_id = ?'),
  countNotes: db.prepare('SELECT COUNT(*) as count FROM notes WHERE guild_id = ? AND user_id = ?'),
};

function getEconomy(guildId, userId) {
  const row = stmts.getEconomy.get(guildId, userId);
  if (row) return row;
  stmts.upsertEconomy.run(guildId, userId, 0, 0, 0, 0);
  return { wallet: 0, bank: 0 };
}

function saveEconomy(guildId, userId, wallet, bank) {
  stmts.upsertEconomy.run(guildId, userId, wallet, bank, wallet, bank);
}

const configCache = new Map();

module.exports = {
  db,

  // Flush the WAL into the main file and close, for a clean shutdown.
  close() {
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
    try { db.close(); } catch { /* ignore */ }
  },

  // Write-through cache of raw JSON strings (null = known missing). Only this module writes the config table.
  // Raw strings, parsed per read, so callers that mutate a returned array/object can't corrupt the cache.
  getConfig(guildId, key) {
    const ck = `${guildId}\u0000${key}`;
    let raw = configCache.get(ck);
    if (raw === undefined) {
      const row = stmts.getConfig.get(guildId, key);
      raw = row ? row.value : null;
      configCache.set(ck, raw);
    }
    if (raw === null) return null;
    try { return JSON.parse(raw); } catch { return raw; }
  },

  // Drop cached config for a guild (used after rows are deleted directly in SQL, e.g. the retention purge).
  clearConfigCache(guildId) {
    const prefix = `${guildId}\u0000`;
    for (const k of configCache.keys()) if (k.startsWith(prefix)) configCache.delete(k);
  },

  setConfig(guildId, key, value) {
    const ck = `${guildId}\u0000${key}`;
    if (value === null || value === undefined) {
      stmts.deleteConfig.run(guildId, key);
      configCache.set(ck, null);
    } else {
      const raw = JSON.stringify(value);
      stmts.setConfig.run(guildId, key, raw);
      configCache.set(ck, raw);
    }
  },

  addWarning(guildId, userId, warning) {
    // an import may carry the original date; anything unparseable falls back to now
    const given = warning.timestamp ? new Date(warning.timestamp) : null;
    const timestamp = given && !Number.isNaN(given.getTime()) ? given.toISOString() : new Date().toISOString();
    // Callers have used both `moderator` and `moderatorId`; accept either so the issuer is never lost.
    const moderator = warning.moderator || warning.moderatorId || null;
    const info = stmts.addWarning.run(guildId, userId, moderator, warning.reason || null, timestamp);
    return info.lastInsertRowid;
  },

  getWarnings(guildId, userId) {
    return stmts.getWarnings.all(guildId, userId).map((w) => ({
      id: w.id,
      moderator: w.moderator,
      moderatorId: w.moderator, // alias: /warn list reads this name
      reason: w.reason,
      timestamp: w.timestamp,
    }));
  },

  removeWarning(guildId, userId, warningId) {
    const info = stmts.removeWarning.run(warningId, guildId, userId);
    return info.changes > 0;
  },

  clearWarnings(guildId, userId) {
    const count = stmts.countWarnings.get(guildId, userId).count;
    stmts.clearWarnings.run(guildId, userId);
    return count;
  },

  getBalance(guildId, userId) {
    const e = getEconomy(guildId, userId);
    return { wallet: e.wallet, bank: e.bank, total: e.wallet + e.bank };
  },

  // Set wallet and bank together in one statement (admin edits).
  setBalance(guildId, userId, wallet, bank) {
    getEconomy(guildId, userId);
    saveEconomy(guildId, userId, Math.max(0, wallet), Math.max(0, bank));
  },

  addWallet(guildId, userId, amount) {
    const e = getEconomy(guildId, userId);
    const newWallet = Math.max(0, e.wallet + amount);
    saveEconomy(guildId, userId, newWallet, e.bank);
    return newWallet;
  },

  addBank(guildId, userId, amount) {
    const e = getEconomy(guildId, userId);
    const newBank = e.bank + amount;
    saveEconomy(guildId, userId, e.wallet, newBank);
    return newBank;
  },

  getBankCapacity(guildId, userId) {
    const inv = this.getConfig(guildId, `inv_${userId}`) || {};
    const notes = inv.bank_note || 0;
    return 25000 + (notes * 10000);
  },

  deposit(guildId, userId, amount) {
    // one transaction: all reads and writes commit together or not at all
    return db.transaction(() => {
      const e = getEconomy(guildId, userId);
      if (amount > e.wallet) return null;
      const cap = this.getBankCapacity(guildId, userId);
      const space = Math.max(0, cap - e.bank);
      const actual = Math.min(amount, space);
      if (actual <= 0) return { wallet: e.wallet, bank: e.bank, full: true };
      const wallet = e.wallet - actual;
      const bank = e.bank + actual;
      saveEconomy(guildId, userId, wallet, bank);
      return { wallet, bank, deposited: actual };
    })();
  },

  withdraw(guildId, userId, amount) {
    // one transaction: all reads and writes commit together or not at all
    return db.transaction(() => {
      const e = getEconomy(guildId, userId);
      if (amount > e.bank) return null;
      const wallet = e.wallet + amount;
      const bank = e.bank - amount;
      saveEconomy(guildId, userId, wallet, bank);
      return { wallet, bank };
    })();
  },

  transfer(guildId, fromId, toId, amount) {
    // one transaction: all reads and writes commit together or not at all
    return db.transaction(() => {
      const from = getEconomy(guildId, fromId);
      if (amount > from.wallet) return null;
      const to = getEconomy(guildId, toId);
      const fromWallet = from.wallet - amount;
      const toWallet = to.wallet + amount;
      saveEconomy(guildId, fromId, fromWallet, from.bank);
      saveEconomy(guildId, toId, toWallet, to.bank);
      return { from: fromWallet, to: toWallet };
    })();
  },

  getLeaderboard(guildId, limit = 10) {
    return stmts.getLeaderboard.all(guildId, limit).map((r) => ({ userId: r.user_id, total: r.total }));
  },

  setCooldown(guildId, userId, key, expiresAt) {
    stmts.setCooldown.run(guildId, userId, key, expiresAt);
  },

  getCooldown(guildId, userId, key) {
    const row = stmts.getCooldown.get(guildId, userId, key);
    if (!row) return null;
    if (Date.now() > row.expires_at) {
      stmts.deleteCooldown.run(guildId, userId, key);
      return null;
    }
    return row.expires_at;
  },

  addCustomCommand(guildId, name, data) {
    stmts.addCustomCmd.run(guildId, name.toLowerCase(), data.response, data.embed ? 1 : 0);
  },

  removeCustomCommand(guildId, name) {
    const info = stmts.removeCustomCmd.run(guildId, name.toLowerCase());
    return info.changes > 0;
  },

  getCustomCommand(guildId, name) {
    const row = stmts.getCustomCmd.get(guildId, name.toLowerCase());
    if (!row) return null;
    return { response: row.response, embed: !!row.embed };
  },

  listCustomCommands(guildId) {
    return stmts.listCustomCmds.all(guildId).map((r) => [r.name, { response: r.response, embed: !!r.embed }]);
  },

  addNote(guildId, userId, moderator, content) {
    const timestamp = new Date().toISOString();
    const info = stmts.addNote.run(guildId, userId, moderator, content, timestamp);
    return info.lastInsertRowid;
  },

  getNotes(guildId, userId) {
    return stmts.getNotes.all(guildId, userId).map((n) => ({
      id: n.id,
      moderator: n.moderator,
      content: n.content,
      timestamp: n.timestamp,
    }));
  },

  removeNote(guildId, noteId) {
    const info = stmts.removeNote.run(noteId, guildId);
    return info.changes > 0;
  },

  countNotes(guildId, userId) {
    return stmts.countNotes.get(guildId, userId).count;
  },
};
