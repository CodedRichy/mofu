// Moderation cases (per-guild incrementing numbers) and DB-backed tempbans.
// Both tables carry guild_id, so the 30-day retention purge covers them automatically.
// create(db) builds the API on any better-sqlite3 handle (tests pass ':memory:'); the module-level functions use
// the bot's shared database, opened lazily so requiring this file never touches data/sonder.db by itself.

const REASON_MAX = 512;
const DAY_MS = 86400000;

const cap = (s, n) => {
  if (s === null || s === undefined) return null;
  const t = String(s);
  return t.length > n ? `${t.slice(0, n - 3)}...` : t;
};

function create(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mod_cases (
      guild_id TEXT NOT NULL,
      case_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      target_id TEXT,
      target_tag TEXT,
      moderator_id TEXT,
      moderator_tag TEXT,
      reason TEXT,
      duration TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      log_channel_id TEXT,
      log_message_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      updated_by TEXT,
      PRIMARY KEY (guild_id, case_id)
    );
    CREATE INDEX IF NOT EXISTS idx_mod_cases_target ON mod_cases(guild_id, target_id);
    CREATE TABLE IF NOT EXISTS tempbans (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_tag TEXT,
      expires_at INTEGER NOT NULL,
      next_try_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      case_id INTEGER,
      moderator_id TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_tempbans_due ON tempbans(next_try_at);
  `);

  const stmts = {
    maxCase: db.prepare('SELECT MAX(case_id) AS m FROM mod_cases WHERE guild_id = ?'),
    insertCase: db.prepare(`INSERT INTO mod_cases (guild_id, case_id, action, target_id, target_tag, moderator_id, moderator_tag, reason, duration, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    getCase: db.prepare('SELECT * FROM mod_cases WHERE guild_id = ? AND case_id = ?'),
    setReason: db.prepare('UPDATE mod_cases SET reason = ?, updated_at = ?, updated_by = ? WHERE guild_id = ? AND case_id = ?'),
    voidCase: db.prepare("UPDATE mod_cases SET status = 'void', updated_at = ?, reason = COALESCE(reason, '') || ? WHERE guild_id = ? AND case_id = ? AND status = 'active'"),
    attachLog: db.prepare('UPDATE mod_cases SET log_channel_id = ?, log_message_id = ? WHERE guild_id = ? AND case_id = ?'),
    casesFor: db.prepare('SELECT * FROM mod_cases WHERE guild_id = ? AND target_id = ? ORDER BY case_id DESC LIMIT ?'),

    upsertTempban: db.prepare(`INSERT INTO tempbans (guild_id, user_id, user_tag, expires_at, next_try_at, attempts, case_id, moderator_id, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET user_tag = excluded.user_tag, expires_at = excluded.expires_at,
        next_try_at = excluded.next_try_at, attempts = 0, case_id = excluded.case_id, moderator_id = excluded.moderator_id,
        created_at = excluded.created_at`),
    getTempban: db.prepare('SELECT * FROM tempbans WHERE guild_id = ? AND user_id = ?'),
    removeTempban: db.prepare('DELETE FROM tempbans WHERE guild_id = ? AND user_id = ?'),
    removeTempbanIf: db.prepare('DELETE FROM tempbans WHERE guild_id = ? AND user_id = ? AND expires_at = ?'),
    deferTempban: db.prepare('UPDATE tempbans SET attempts = ?, next_try_at = ? WHERE guild_id = ? AND user_id = ? AND expires_at = ?'),
    dueTempbans: db.prepare('SELECT * FROM tempbans WHERE next_try_at <= ? ORDER BY next_try_at ASC LIMIT ?'),
    listTempbans: db.prepare('SELECT * FROM tempbans WHERE guild_id = ? ORDER BY expires_at ASC LIMIT ?'),
  };

  // Read-max-then-insert under an IMMEDIATE transaction: the write lock is taken before the read, so two
  // processes (shards) sharing the file can never pick the same number. The primary key is the last guard.
  const allocate = db.transaction((guildId, row) => {
    const next = (stmts.maxCase.get(guildId).m || 0) + 1;
    stmts.insertCase.run(guildId, next, row.action, row.targetId, row.targetTag, row.moderatorId, row.moderatorTag, row.reason, row.duration, row.createdAt);
    return next;
  });

  return {
    REASON_MAX,

    // Returns the new case number.
    openCase({ guildId, action, targetId = null, targetTag = null, moderatorId = null, moderatorTag = null, reason = null, duration = null, now = Date.now() }) {
      if (!guildId || !action) throw new Error('openCase needs guildId and action');
      return allocate.immediate(String(guildId), {
        action: cap(action, 40),
        targetId: targetId ? String(targetId) : null,
        targetTag: cap(targetTag, 100),
        moderatorId: moderatorId ? String(moderatorId) : null,
        moderatorTag: cap(moderatorTag, 100),
        reason: cap(reason, REASON_MAX),
        duration: cap(duration, 40),
        createdAt: now,
      });
    },

    getCase(guildId, caseId) {
      return stmts.getCase.get(String(guildId), Number(caseId)) || null;
    },

    // Returns the updated row, or null when the case does not exist.
    setReason(guildId, caseId, reason, editorId = null, now = Date.now()) {
      const info = stmts.setReason.run(cap(reason, REASON_MAX), now, editorId, String(guildId), Number(caseId));
      return info.changes ? this.getCase(guildId, caseId) : null;
    },

    // The action behind an opened case did not happen (Discord refused). The number stays used; the case says so.
    voidCase(guildId, caseId, note = 'action failed', now = Date.now()) {
      if (!caseId) return false;
      return stmts.voidCase.run(now, ` [void: ${cap(note, 60)}]`, String(guildId), Number(caseId)).changes > 0;
    },

    attachLogMessage(guildId, caseId, channelId, messageId) {
      if (!caseId) return false;
      return stmts.attachLog.run(channelId, messageId, String(guildId), Number(caseId)).changes > 0;
    },

    casesFor(guildId, targetId, limit = 10) {
      return stmts.casesFor.all(String(guildId), String(targetId), Math.min(Math.max(limit | 0, 1), 50));
    },

    addTempban({ guildId, userId, userTag = null, expiresAt, caseId = null, moderatorId = null, now = Date.now() }) {
      if (!Number.isFinite(expiresAt)) throw new Error('addTempban needs expiresAt');
      stmts.upsertTempban.run(String(guildId), String(userId), cap(userTag, 100), expiresAt, expiresAt, caseId, moderatorId, now);
    },

    getTempban(guildId, userId) {
      return stmts.getTempban.get(String(guildId), String(userId)) || null;
    },

    // expiresAt given: only delete that exact row, so a re-tempban made mid-sweep is not wiped.
    removeTempban(guildId, userId, expiresAt) {
      const info = expiresAt === undefined
        ? stmts.removeTempban.run(String(guildId), String(userId))
        : stmts.removeTempbanIf.run(String(guildId), String(userId), expiresAt);
      return info.changes > 0;
    },

    deferTempban(guildId, userId, expiresAt, attempts, nextTryAt) {
      return stmts.deferTempban.run(attempts, nextTryAt, String(guildId), String(userId), expiresAt).changes > 0;
    },

    dueTempbans(now = Date.now(), limit = 500) {
      return stmts.dueTempbans.all(now, limit);
    },

    listTempbans(guildId, limit = 25) {
      return stmts.listTempbans.all(String(guildId), limit);
    },
  };
}

let shared = null;
function api() {
  if (!shared) shared = create(require('./store').db);
  return shared;
}

const methods = ['openCase', 'getCase', 'setReason', 'voidCase', 'attachLogMessage', 'casesFor',
  'addTempban', 'getTempban', 'removeTempban', 'deferTempban', 'dueTempbans', 'listTempbans'];
const lazy = {};
for (const m of methods) lazy[m] = (...args) => api()[m](...args);

module.exports = { create, REASON_MAX, DAY_MS, ...lazy };
