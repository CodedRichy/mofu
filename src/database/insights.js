// Per-server insights: aggregate counters only. One number per guild per UTC day (messages, joins, leaves)
// and one per guild per day per command name. No user ids, no channel ids, no message text.
// Both tables carry guild_id, so src/database/retention.js purges them 30 days after the bot leaves.
// Counts are buffered in memory and flushed every 60s (and at 2000 buffered keys), never one write per message.
// create(db) builds the API on any better-sqlite3 handle (tests pass ':memory:'); the module-level functions
// use the bot's shared database, opened lazily so requiring this file never touches data/sonder.db by itself.

const DAY_MS = 86400000;
const KEEP_DAYS = 90;
const FLUSH_MS = 60 * 1000;
const FLUSH_AT = 2000;
const PRUNE_EVERY_MS = 6 * 3600 * 1000;
const CMD_MAX = 40;
const SEP = '\u0001';

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

function create(db) {
  require('./infractions').create(db); // makes sure mod_cases exists even before the first case is opened
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_daily_stats (
      guild_id TEXT NOT NULL,
      day TEXT NOT NULL,
      messages INTEGER NOT NULL DEFAULT 0,
      joins INTEGER NOT NULL DEFAULT 0,
      leaves INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, day)
    );
    CREATE TABLE IF NOT EXISTS guild_daily_commands (
      guild_id TEXT NOT NULL,
      day TEXT NOT NULL,
      command TEXT NOT NULL,
      uses INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, day, command)
    );
  `);

  const stmts = {
    addStat: db.prepare(`INSERT INTO guild_daily_stats (guild_id, day, messages, joins, leaves) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, day) DO UPDATE SET messages = messages + excluded.messages, joins = joins + excluded.joins, leaves = leaves + excluded.leaves`),
    addCmd: db.prepare(`INSERT INTO guild_daily_commands (guild_id, day, command, uses) VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id, day, command) DO UPDATE SET uses = uses + excluded.uses`),
    since: db.prepare('SELECT MIN(day) AS d FROM guild_daily_stats WHERE guild_id = ?'),
    statRange: db.prepare('SELECT day, messages, joins, leaves FROM guild_daily_stats WHERE guild_id = ? AND day >= ? AND day <= ? ORDER BY day'),
    cmdRange: db.prepare('SELECT command, SUM(uses) AS n FROM guild_daily_commands WHERE guild_id = ? AND day >= ? AND day <= ? GROUP BY command ORDER BY n DESC, command ASC LIMIT ?'),
    cmdTotal: db.prepare('SELECT SUM(uses) AS n FROM guild_daily_commands WHERE guild_id = ? AND day >= ? AND day <= ?'),
    casesDay: db.prepare("SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM mod_cases WHERE guild_id = ? AND created_at >= ? AND created_at < ? AND status != 'void' GROUP BY day"),
    casesType: db.prepare("SELECT LOWER(action) AS type, COUNT(*) AS n FROM mod_cases WHERE guild_id = ? AND created_at >= ? AND created_at < ? AND status != 'void' GROUP BY LOWER(action) ORDER BY n DESC, type ASC LIMIT 12"),
    casesCount: db.prepare("SELECT COUNT(*) AS n FROM mod_cases WHERE guild_id = ? AND created_at >= ? AND created_at < ? AND status != 'void'"),
    pruneStats: db.prepare('DELETE FROM guild_daily_stats WHERE day < ?'),
    pruneCmds: db.prepare('DELETE FROM guild_daily_commands WHERE day < ?'),
  };

  const pendingStats = new Map(); // guild|day -> [messages, joins, leaves]
  const pendingCmds = new Map(); // guild|day|command -> n
  let timer = null;
  let lastPrune = 0;

  function flush() {
    if (!pendingStats.size && !pendingCmds.size) return;
    const stats = [...pendingStats];
    const cmds = [...pendingCmds];
    pendingStats.clear();
    pendingCmds.clear();
    try {
      db.transaction(() => {
        for (const [key, v] of stats) { const [g, d] = key.split(SEP); stmts.addStat.run(g, d, v[0], v[1], v[2]); }
        for (const [key, n] of cmds) { const [g, d, c] = key.split(SEP); stmts.addCmd.run(g, d, c, n); }
      })();
    } catch (err) { require('../utils/logger').error('insights flush failed:', err?.message || err); }
    const now = Date.now();
    if (now - lastPrune > PRUNE_EVERY_MS) { lastPrune = now; api.prune(now); }
  }

  function ensureTimer() {
    if (timer) return;
    timer = setInterval(flush, FLUSH_MS);
    timer.unref?.();
  }

  function bump(guildId, now, i) {
    if (!guildId) return;
    const key = `${guildId}${SEP}${dayKey(now)}`;
    let v = pendingStats.get(key);
    if (!v) { v = [0, 0, 0]; pendingStats.set(key, v); }
    v[i] += 1;
    ensureTimer();
    if (pendingStats.size + pendingCmds.size >= FLUSH_AT) flush();
  }

  const rangeOf = (days, now, offsetDays = 0) => {
    const end = now - offsetDays * DAY_MS;
    const list = [];
    for (let i = days - 1; i >= 0; i--) list.push(dayKey(end - i * DAY_MS));
    return list;
  };

  const api = {
    DAY_MS, KEEP_DAYS, FLUSH_AT,
    countMessage(guildId, now = Date.now()) { bump(guildId, now, 0); },
    countJoin(guildId, now = Date.now()) { bump(guildId, now, 1); },
    countLeave(guildId, now = Date.now()) { bump(guildId, now, 2); },
    countCommand(guildId, command, now = Date.now()) {
      if (!guildId || !command) return;
      const key = `${guildId}${SEP}${dayKey(now)}${SEP}${String(command).slice(0, CMD_MAX)}`;
      pendingCmds.set(key, (pendingCmds.get(key) || 0) + 1);
      ensureTimer();
      if (pendingStats.size + pendingCmds.size >= FLUSH_AT) flush();
    },
    flush,
    prune(now = Date.now()) {
      const cutoff = dayKey(now - KEEP_DAYS * DAY_MS);
      return stmts.pruneStats.run(cutoff).changes + stmts.pruneCmds.run(cutoff).changes;
    },

    // Everything the dashboard Insights tab shows for one guild. Aggregates only. A counter day before the first
    // tracked day is null ("not counted"), never 0; a day after it with no row is a real 0.
    query(guildId, { days = 7, now = Date.now() } = {}) {
      flush();
      guildId = String(guildId);
      days = days === 30 ? 30 : 7;
      const cur = rangeOf(days, now);
      const prev = rangeOf(days, now, days);
      const from = cur[0];
      const to = cur[cur.length - 1];
      const prevFrom = prev[0];
      const prevTo = prev[prev.length - 1];
      const since = stmts.since.get(guildId)?.d || null;
      const notes = [];

      const rows = new Map(stmts.statRange.all(guildId, prevFrom, to).map((r) => [r.day, r]));
      const counted = (day) => since !== null && day >= since;
      const series = (field) => cur.map((date) => (counted(date) ? { date, count: rows.get(date)?.[field] || 0 } : { date, count: null }));
      const sum = (list, field) => {
        if (!list.some(counted)) return null;
        return list.reduce((a, d) => a + (rows.get(d)?.[field] || 0), 0);
      };
      // The previous period is comparable only when counting began before it did.
      const prevComparable = since !== null && since <= prevFrom;

      const startMs = Date.parse(`${from}T00:00:00Z`);
      const endMs = Date.parse(`${to}T00:00:00Z`) + DAY_MS;
      const prevStartMs = Date.parse(`${prevFrom}T00:00:00Z`);

      const caseRows = new Map(stmts.casesDay.all(guildId, startMs, endMs).map((r) => [r.day, r.n]));
      const modActions = cur.map((date) => ({ date, count: caseRows.get(date) || 0 }));
      const modTotal = stmts.casesCount.get(guildId, startMs, endMs).n;
      const modPrev = stmts.casesCount.get(guildId, prevStartMs, startMs).n;
      const modByType = stmts.casesType.all(guildId, startMs, endMs).map((r) => ({ type: r.type, count: r.n }));

      const countersOn = since !== null;
      const cmdTotal = countersOn ? (stmts.cmdTotal.get(guildId, from, to).n || 0) : null;
      const topCommands = countersOn ? stmts.cmdRange.all(guildId, from, to, 8).map((r) => ({ name: r.command, count: r.n })) : [];

      const messages = sum(cur, 'messages');
      const totals = {
        messages, joins: sum(cur, 'joins'), leaves: sum(cur, 'leaves'),
        modActions: modTotal, commands: cmdTotal,
      };
      totals.netMembers = totals.joins === null ? null : totals.joins - totals.leaves;
      const previous = {
        messages: prevComparable ? sum(prev, 'messages') : null,
        joins: prevComparable ? sum(prev, 'joins') : null,
        leaves: prevComparable ? sum(prev, 'leaves') : null,
        modActions: modPrev,
        commands: null,
      };
      if (prevComparable) {
        previous.commands = stmts.cmdTotal.get(guildId, prevFrom, prevTo).n || 0;
      }

      let busiest = null;
      if (messages) {
        for (const p of series('messages')) if (p.count && (!busiest || p.count > busiest.count)) busiest = p;
      }

      if (!countersOn) {
        notes.push('message, join, leave and command counts have not started yet for this server. they fill in as the server is used.');
      } else {
        if (since > from) notes.push(`message, join, leave and command counts start from ${since}. earlier days show as not counted.`);
        if (!prevComparable) notes.push('no comparison with the previous period yet: counting started inside it.');
      }
      notes.push('mod actions are logged cases (voided ones left out). warnings and notes each log a case.');

      return {
        range: { days, from, to },
        counters: { available: countersOn, since },
        series: { messages: series('messages'), joins: series('joins'), leaves: series('leaves'), modActions },
        totals, previous, topCommands, modByType, busiest, notes,
      };
    },

    // Distinct members who earned XP (a message that passed the XP cooldown) in the last `days` days.
    // null when the server has no XP rows at all (leveling never ran), so the UI says "not available".
    activeChatters(guildId, days, now = Date.now()) {
      try {
        const total = db.prepare('SELECT COUNT(*) AS n FROM xp WHERE guild_id = ?').get(String(guildId)).n;
        if (!total) return null;
        return db.prepare('SELECT COUNT(*) AS n FROM xp WHERE guild_id = ? AND last_message >= ?').get(String(guildId), now - days * DAY_MS).n;
      } catch { return null; }
    },

    _db: db,
    _pending: { stats: pendingStats, cmds: pendingCmds },
  };
  return api;
}

let shared = null;
function sharedApi() {
  if (!shared) shared = create(require('./store').db);
  return shared;
}

const methods = ['countMessage', 'countJoin', 'countLeave', 'countCommand', 'flush', 'prune', 'query', 'activeChatters'];
const lazy = {};
for (const m of methods) lazy[m] = (...args) => sharedApi()[m](...args);

module.exports = { create, dayKey, DAY_MS, KEEP_DAYS, ...lazy };
