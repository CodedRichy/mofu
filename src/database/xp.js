const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.SONDER_XP_DB || path.join(__dirname, '..', '..', 'data', 'sonder.db');
require('fs').mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS xp (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 0,
    total_xp INTEGER DEFAULT 0,
    last_message INTEGER DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_xp_guild_user ON xp(guild_id, user_id);
`);

const stmts = {
  get: db.prepare('SELECT xp, level, total_xp, last_message FROM xp WHERE guild_id = ? AND user_id = ?'),
  upsert: db.prepare('INSERT INTO xp (guild_id, user_id, xp, level, total_xp, last_message) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET xp = ?, level = ?, total_xp = ?, last_message = ?'),
  leaderboard: db.prepare('SELECT user_id, level, total_xp FROM xp WHERE guild_id = ? ORDER BY total_xp DESC LIMIT ?'),
  rank: db.prepare('SELECT COUNT(*) as rank FROM xp WHERE guild_id = ? AND total_xp > COALESCE((SELECT total_xp FROM xp WHERE guild_id = ? AND user_id = ?), 0)'),
  atLevel: db.prepare('SELECT user_id, level FROM xp WHERE guild_id = ? AND level >= ? ORDER BY level DESC LIMIT ?'),
};

// Members at or past `minLevel`, highest first (used by /levelrole sync).
function getMembersAtLevel(guildId, minLevel, limit = 1000) {
  return stmts.atLevel.all(guildId, minLevel, limit).map((r) => ({ userId: r.user_id, level: r.level }));
}

function xpForLevel(level) {
  return 5 * (level * level) + 50 * level + 100;
}

function getMember(guildId, userId) {
  const row = stmts.get.get(guildId, userId);
  if (row) return { xp: row.xp, level: row.level, totalXp: row.total_xp, lastMessage: row.last_message };
  return { xp: 0, level: 0, totalXp: 0, lastMessage: 0 };
}

function saveMember(guildId, userId, m) {
  stmts.upsert.run(guildId, userId, m.xp, m.level, m.totalXp, m.lastMessage, m.xp, m.level, m.totalXp, m.lastMessage);
}

function addXp(guildId, userId, amount) {
  const m = getMember(guildId, userId);
  m.xp += amount;
  m.totalXp += amount;

  let leveledUp = false;
  while (m.xp >= xpForLevel(m.level)) {
    m.xp -= xpForLevel(m.level);
    m.level++;
    leveledUp = true;
  }

  saveMember(guildId, userId, m);
  return { level: m.level, xp: m.xp, needed: xpForLevel(m.level), totalXp: m.totalXp, leveledUp };
}

function getStats(guildId, userId) {
  const m = getMember(guildId, userId);
  return { level: m.level, xp: m.xp, needed: xpForLevel(m.level), totalXp: m.totalXp };
}

function canEarnXp(guildId, userId, cooldownMs) {
  const m = getMember(guildId, userId);
  const now = Date.now();
  if (now - m.lastMessage < cooldownMs) return false;
  m.lastMessage = now;
  saveMember(guildId, userId, m);
  return true;
}

function getLeaderboard(guildId, limit = 10) {
  return stmts.leaderboard.all(guildId, limit).map((r) => ({ userId: r.user_id, level: r.level, totalXp: r.total_xp }));
}

const MAX_LEVEL = 1000;
const MAX_XP = 2 ** 31;

// Reject non-integers/negatives, clamp huge values so the O(level) loops stay bounded.
function clampInt(value, max, label) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
  return Math.min(value, max);
}

function setLevel(guildId, userId, level) {
  level = clampInt(level, MAX_LEVEL, 'level');
  const m = { xp: 0, level, totalXp: 0, lastMessage: getMember(guildId, userId).lastMessage };
  for (let i = 0; i < level; i++) m.totalXp += xpForLevel(i);
  saveMember(guildId, userId, m);
  return { level: m.level, xp: m.xp, needed: xpForLevel(m.level), totalXp: m.totalXp };
}

function setXp(guildId, userId, xp) {
  xp = clampInt(xp, MAX_XP, 'xp');
  const m = { xp: 0, level: 0, totalXp: xp, lastMessage: getMember(guildId, userId).lastMessage };
  let remaining = xp;
  while (remaining >= xpForLevel(m.level)) {
    remaining -= xpForLevel(m.level);
    m.level++;
  }
  m.xp = remaining;
  saveMember(guildId, userId, m);
  return { level: m.level, xp: m.xp, needed: xpForLevel(m.level), totalXp: m.totalXp };
}

function getRank(guildId, userId) {
  const row = stmts.rank.get(guildId, guildId, userId);
  return (row?.rank ?? 0) + 1;
}

// Total XP needed to reach `level` from zero.
function totalXpForLevel(level) {
  level = Math.min(Math.max(0, Math.floor(level) || 0), MAX_LEVEL);
  let total = 0;
  for (let i = 0; i < level; i++) total += xpForLevel(i);
  return total;
}

// Split a total into { level, xp } where xp is progress inside the current level.
function levelFromTotal(totalXp) {
  let remaining = Math.min(Math.max(0, Math.floor(totalXp) || 0), MAX_XP);
  let level = 0;
  while (remaining >= xpForLevel(level)) { remaining -= xpForLevel(level); level++; }
  return { level, xp: remaining };
}

/**
 * Bulk import of total XP, one transaction. Never lowers a member's XP unless `overwrite` is true.
 * Re-reads each row inside the transaction, so a second identical run changes nothing.
 * @param {{userId: string, totalXp: number}[]} entries
 * @returns {{ written: number, unchanged: number, lowered: number }}
 */
function importTotals(guildId, entries, { overwrite = false } = {}) {
  const out = { written: 0, unchanged: 0, lowered: 0 };
  db.transaction(() => {
    for (const e of entries) {
      const incoming = clampInt(e.totalXp, MAX_XP, 'xp');
      const cur = getMember(guildId, e.userId);
      const target = overwrite ? incoming : Math.max(cur.totalXp, incoming);
      if (target === cur.totalXp) { out.unchanged++; continue; }
      if (target < cur.totalXp) out.lowered++;
      const { level, xp } = levelFromTotal(target);
      saveMember(guildId, e.userId, { xp, level, totalXp: target, lastMessage: cur.lastMessage });
      out.written++;
    }
  })();
  return out;
}

// Read-only snapshot of current totals for a set of users (dry runs).
function getTotals(guildId, userIds) {
  const map = new Map();
  for (const id of userIds) map.set(id, getMember(guildId, id).totalXp);
  return map;
}

module.exports = { clampInt, MAX_LEVEL, MAX_XP, addXp, getStats, canEarnXp, getLeaderboard, setLevel, setXp, getRank, xpForLevel, getMembersAtLevel, totalXpForLevel, levelFromTotal, importTotals, getTotals };
