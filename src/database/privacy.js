// User-level privacy operations. Pure functions over a better-sqlite3 handle (tests pass a temp DB; the bot
// passes store.db). Nothing here touches the config cache: callers clear it for the guilds returned.
//
// What /forgetme deletes is an explicit allowlist, not "every table with a user_id": moderation records
// (warnings, notes, ai_actions, infractions/cases added later) must survive a self-service delete, or anyone
// could wipe their own record before an appeal. Tables not listed here are kept, and the command says so.

const SNOWFLAKE = /^\d{17,20}$/;

// table -> column holding the user's id. Personal, non-moderation data only.
const USER_TABLES = [
  { table: 'xp', column: 'user_id', label: 'XP and level' },
  { table: 'economy', column: 'user_id', label: 'economy balance' },
  { table: 'cooldowns', column: 'user_id', label: 'cooldowns' },
  { table: 'birthdays', column: 'user_id', label: 'birthday' },
  { table: 'invite_counts', column: 'user_id', label: 'invite count' },
  { table: 'invites', column: 'user_id', label: 'join record' },
  { table: 'reminders', column: 'user_id', label: 'reminders' },
  { table: 'snipes', column: 'author_id', label: 'deleted/edited message snapshots' },
];

// Per-user config keys (config table, key = `${prefix}${userId}`).
const USER_CONFIG_PREFIXES = [
  { prefix: 'afk_', label: 'AFK status' },
  { prefix: 'inv_', label: 'inventory' },
  { prefix: 'lastfm_', label: 'Last.fm username' },
  { prefix: 'fmact_', label: 'Last.fm activity marker' },
  { prefix: 'fmhide_', label: 'Last.fm ranking preference' },
  { prefix: 'tz_', label: 'timezone' },
];

// Said out loud in the confirm prompt and the result, so nobody thinks their record was wiped.
const KEPT_NOTE = 'Moderation records (warnings, mod notes, cases, AI action logs, jail/hardmute saved roles, forced nicknames) are kept: they belong to the server\'s safety record, not to you. Messages you sent on Discord are Discord\'s, not ours.';

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}
function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info("${table}")`).all().some((c) => c.name === column);
}

// Delete one user's personal rows. guildId null = every server (self only; the command enforces that).
// Returns { total, byLabel: {label: n}, guilds: [guild ids whose config changed], unlinked }.
function forgetUser(db, userId, { guildId = null } = {}) {
  if (!SNOWFLAKE.test(String(userId))) throw new Error('forgetUser: invalid user id');
  if (guildId !== null && !SNOWFLAKE.test(String(guildId))) throw new Error('forgetUser: invalid guild id');
  const uid = String(userId);
  const byLabel = {};
  const guilds = new Set();
  let total = 0;
  let unlinked = 0;
  const add = (label, n) => { if (n > 0) { byLabel[label] = (byLabel[label] || 0) + n; total += n; } };
  const scope = guildId === null ? '' : ' AND guild_id = ?';
  const args = (extra) => (guildId === null ? [extra] : [extra, String(guildId)]);

  db.transaction(() => {
    for (const { table, column, label } of USER_TABLES) {
      if (!tableExists(db, table) || !hasColumn(db, table, column) || !hasColumn(db, table, 'guild_id')) continue;
      add(label, db.prepare(`DELETE FROM "${table}" WHERE "${column}" = ?${scope}`).run(...args(uid)).changes);
    }
    // Other people's join records name this user as inviter: keep the record, drop the link.
    if (tableExists(db, 'invites') && hasColumn(db, 'invites', 'inviter_id')) {
      unlinked += db.prepare(`UPDATE invites SET inviter_id = NULL WHERE inviter_id = ?${scope}`).run(...args(uid)).changes;
    }
    // Quotes of this user (author column holds JSON {id, tag}).
    if (tableExists(db, 'quotes') && hasColumn(db, 'quotes', 'author')) {
      add('quotes of you', db.prepare(
        `DELETE FROM quotes WHERE json_valid(author) AND json_extract(author, '$.id') = ?${scope}`,
      ).run(...args(uid)).changes);
    }
    if (tableExists(db, 'config')) {
      for (const { prefix, label } of USER_CONFIG_PREFIXES) {
        const key = `${prefix}${uid}`;
        const rows = db.prepare(`SELECT guild_id FROM config WHERE key = ?${scope}`).all(...args(key));
        rows.forEach((r) => guilds.add(r.guild_id));
        add(label, db.prepare(`DELETE FROM config WHERE key = ?${scope}`).run(...args(key)).changes);
      }
      // Last.fm crowns name the holder by id inside one per-server JSON map: drop this member's entries.
      const crownRows = db.prepare(`SELECT guild_id, value FROM config WHERE key = 'fm_crowns'${scope}`).all(...(guildId === null ? [] : [String(guildId)]));
      for (const row of crownRows) {
        let map;
        try { map = JSON.parse(row.value); } catch { continue; }
        if (!map || typeof map !== 'object') continue;
        const kept = Object.fromEntries(Object.entries(map).filter(([, c]) => !(c && String(c.u) === uid)));
        const removed = Object.keys(map).length - Object.keys(kept).length;
        if (!removed) continue;
        if (Object.keys(kept).length) db.prepare("UPDATE config SET value = ? WHERE guild_id = ? AND key = 'fm_crowns'").run(JSON.stringify(kept), row.guild_id);
        else db.prepare("DELETE FROM config WHERE guild_id = ? AND key = 'fm_crowns'").run(row.guild_id);
        guilds.add(row.guild_id);
        add('Last.fm crowns', removed);
      }
    }
  })();

  return { total, byLabel, guilds: [...guilds], unlinked };
}

// Retention: AI action rows keep who/what/when for the audit trail, but the raw chat prompt that triggered
// them is dropped after maxAgeMs (default 30 days). Returns rows scrubbed.
function scrubAiPrompts(db, { now = Date.now(), maxAgeMs = 30 * 86400000 } = {}) {
  if (!tableExists(db, 'ai_actions') || !hasColumn(db, 'ai_actions', 'prompt')) return 0;
  return db.prepare('UPDATE ai_actions SET prompt = NULL WHERE created_at < ? AND prompt IS NOT NULL').run(now - maxAgeMs).changes;
}

module.exports = { forgetUser, scrubAiPrompts, USER_TABLES, USER_CONFIG_PREFIXES, KEPT_NOTE };
