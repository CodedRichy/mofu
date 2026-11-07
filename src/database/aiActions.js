// Audit trail for actions requested through chat ("mofu mute kai"). One row per proposal, updated as it
// resolves, so a server can answer "what did mofu do, who asked, and what was refused?".
// The guild_id column means the 30-day retention purge covers this table automatically.
const { db } = require('./store');
const log = require('../utils/logger');

db.exec(`
  CREATE TABLE IF NOT EXISTS ai_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    invoker_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    reason TEXT,
    duration_ms INTEGER,
    prompt TEXT,
    status TEXT NOT NULL DEFAULT 'proposed',
    note TEXT,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_ai_actions_guild ON ai_actions(guild_id, id DESC);
`);

// proposed -> executed | cancelled | expired | rejected (re-check failed at button press) | failed (Discord refused)
const STATUSES = new Set(['proposed', 'executed', 'cancelled', 'expired', 'rejected', 'failed']);

const stmts = {
  insert: db.prepare('INSERT INTO ai_actions (guild_id, invoker_id, target_id, kind, reason, duration_ms, prompt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  resolve: db.prepare("UPDATE ai_actions SET status = ?, note = ?, resolved_at = ? WHERE id = ? AND status = 'proposed'"),
  recent: db.prepare('SELECT * FROM ai_actions WHERE guild_id = ? ORDER BY id DESC LIMIT ?'),
  recentByStatus: db.prepare('SELECT * FROM ai_actions WHERE guild_id = ? AND status = ? ORDER BY id DESC LIMIT ?'),
};

// The audit trail must never break the action it describes: a failed write is logged and the action carries on.
function record({ guildId, invokerId, targetId, kind, reason = null, durationMs = null, prompt = null }) {
  try {
    return stmts.insert.run(guildId, invokerId, targetId, kind, reason, durationMs, prompt ? String(prompt).slice(0, 300) : null, Date.now()).lastInsertRowid;
  } catch (err) {
    log.warn(`ai_actions record failed: ${err.message}`);
    return null;
  }
}

// Only moves a row out of 'proposed' once, so a late timer can never overwrite a real outcome.
function resolve(id, status, note = null) {
  if (!id || !STATUSES.has(status) || status === 'proposed') return false;
  try {
    return stmts.resolve.run(status, note ? String(note).slice(0, 200) : null, Date.now(), id).changes > 0;
  } catch (err) {
    log.warn(`ai_actions resolve failed: ${err.message}`);
    return false;
  }
}

function recent(guildId, limit = 10, status = null) {
  const n = Math.min(Math.max(limit | 0, 1), 25);
  return status ? stmts.recentByStatus.all(guildId, status, n) : stmts.recent.all(guildId, n);
}

module.exports = { record, resolve, recent, STATUSES };
