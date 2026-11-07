// Appeals against moderation cases. The table carries guild_id, so the 30-day retention purge covers it.
// create(db) builds the API on any better-sqlite3 handle (tests pass ':memory:'); the module-level functions use
// the bot's shared database, opened lazily.

const REASON_MAX = 500;
const DENIED_COOLDOWN_MS = 7 * 86400000; // after a denial the member waits before appealing the same case again

function create(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS appeals (
      guild_id TEXT NOT NULL,
      appeal_id INTEGER NOT NULL,
      case_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      user_tag TEXT,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      log_channel_id TEXT,
      log_message_id TEXT,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER,
      resolved_by TEXT,
      PRIMARY KEY (guild_id, appeal_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_appeals_open ON appeals(guild_id, case_id) WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS idx_appeals_user ON appeals(guild_id, user_id);
  `);

  const stmts = {
    maxId: db.prepare('SELECT MAX(appeal_id) AS m FROM appeals WHERE guild_id = ?'),
    insert: db.prepare('INSERT INTO appeals (guild_id, appeal_id, case_id, user_id, user_tag, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    get: db.prepare('SELECT * FROM appeals WHERE guild_id = ? AND appeal_id = ?'),
    forCase: db.prepare('SELECT * FROM appeals WHERE guild_id = ? AND case_id = ? ORDER BY appeal_id DESC'),
    attach: db.prepare('UPDATE appeals SET log_channel_id = ?, log_message_id = ? WHERE guild_id = ? AND appeal_id = ?'),
    resolve: db.prepare("UPDATE appeals SET status = ?, resolved_at = ?, resolved_by = ? WHERE guild_id = ? AND appeal_id = ? AND status = 'pending'"),
    reopen: db.prepare("UPDATE appeals SET status = 'pending', resolved_at = NULL, resolved_by = NULL WHERE guild_id = ? AND appeal_id = ? AND status = 'approved' AND resolved_by = ?"),
    remove: db.prepare("DELETE FROM appeals WHERE guild_id = ? AND appeal_id = ? AND status = 'pending'"),
    forUser: db.prepare('SELECT * FROM appeals WHERE guild_id = ? AND user_id = ? ORDER BY appeal_id DESC LIMIT ?'),
  };

  const allocate = db.transaction((guildId, row) => {
    const next = (stmts.maxId.get(guildId).m || 0) + 1;
    stmts.insert.run(guildId, next, row.caseId, row.userId, row.userTag, row.reason, row.createdAt);
    return next;
  });

  return {
    REASON_MAX,

    // Why this member cannot file a new appeal on the case, or null. Pure over the rows for that case.
    blockReason(guildId, caseId, now = Date.now()) {
      const rows = stmts.forCase.all(String(guildId), Number(caseId));
      if (rows.some((r) => r.status === 'pending')) return 'There is already an open appeal for this case. Staff will answer it.';
      if (rows.some((r) => r.status === 'approved')) return 'An appeal for this case was already approved.';
      const denied = rows.find((r) => r.status === 'denied');
      if (denied && now - (denied.resolved_at || denied.created_at) < DENIED_COOLDOWN_MS) {
        const until = Math.floor(((denied.resolved_at || denied.created_at) + DENIED_COOLDOWN_MS) / 1000);
        return `An appeal for this case was denied. You can appeal again <t:${until}:R>.`;
      }
      return null;
    },

    // Returns the new appeal id, or null when an open appeal already exists (unique index; also covers a race).
    openAppeal({ guildId, caseId, userId, userTag = null, reason, now = Date.now() }) {
      if (!guildId || !caseId || !userId) throw new Error('openAppeal needs guildId, caseId, userId');
      try {
        return allocate.immediate(String(guildId), {
          caseId: Number(caseId),
          userId: String(userId),
          userTag: userTag ? String(userTag).slice(0, 100) : null,
          reason: String(reason ?? '').slice(0, REASON_MAX),
          createdAt: now,
        });
      } catch (err) {
        if (/UNIQUE/i.test(String(err?.message))) return null;
        throw err;
      }
    },

    getAppeal(guildId, appealId) {
      return stmts.get.get(String(guildId), Number(appealId)) || null;
    },

    attachLogMessage(guildId, appealId, channelId, messageId) {
      return stmts.attach.run(channelId, messageId, String(guildId), Number(appealId)).changes > 0;
    },

    // Atomic pending -> approved|denied. Returns the updated row, or null when it was not pending (already handled).
    resolve(guildId, appealId, status, byId, now = Date.now()) {
      if (status !== 'approved' && status !== 'denied') throw new Error('status must be approved or denied');
      const info = stmts.resolve.run(status, now, String(byId), String(guildId), Number(appealId));
      return info.changes ? this.getAppeal(guildId, appealId) : null;
    },

    // The approval's side effect failed: put the appeal back to pending (only by the same resolver).
    reopen(guildId, appealId, byId) {
      return stmts.reopen.run(String(guildId), Number(appealId), String(byId)).changes > 0;
    },

    // The card could not be posted: drop the pending row so the member is not blocked by a ghost.
    discard(guildId, appealId) {
      return stmts.remove.run(String(guildId), Number(appealId)).changes > 0;
    },

    forUser(guildId, userId, limit = 10) {
      return stmts.forUser.all(String(guildId), String(userId), Math.min(Math.max(limit | 0, 1), 50));
    },
  };
}

let shared = null;
function api() {
  if (!shared) shared = create(require('./store').db);
  return shared;
}

const methods = ['blockReason', 'openAppeal', 'getAppeal', 'attachLogMessage', 'resolve', 'reopen', 'discard', 'forUser'];
const lazy = {};
for (const m of methods) lazy[m] = (...args) => api()[m](...args);

module.exports = { create, REASON_MAX, DENIED_COOLDOWN_MS, ...lazy };
