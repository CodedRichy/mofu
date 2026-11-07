// Counter storage for the weekly health post. Counts, ids and booleans only: never message text.
// Every table has a guild_id column, so src/database/retention.js purges it when the bot leaves a server.
const store = require('./store');
const log = require('../utils/logger');
const H = require('../utils/healthpost');

const { db } = store;

const KEEP_DAILY_DAYS = 35;
const KEEP_NEW_MEMBER_DAYS = 14;
const KEEP_QUESTION_DAYS = 7;
const FLUSH_MS = 30 * 1000;
const FLUSH_AT = 2000; // pending buffer entries before an early flush (memory bound)
const MAX_NEW_PER_GUILD = 5000; // safety cap on the new-member rows kept per guild

db.exec(`
  CREATE TABLE IF NOT EXISTS health_daily (
    guild_id TEXT NOT NULL,
    day TEXT NOT NULL,
    joins INTEGER NOT NULL DEFAULT 0,
    leaves INTEGER NOT NULL DEFAULT 0,
    activated INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, day)
  );
  CREATE TABLE IF NOT EXISTS health_channel_day (
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    day TEXT NOT NULL,
    messages INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, channel_id, day)
  );
  CREATE TABLE IF NOT EXISTS health_new_members (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    joined_at INTEGER NOT NULL,
    activated INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS health_questions (
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    author_id TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    answered INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, message_id)
  );
`);

const stmts = {
  join: db.prepare(`INSERT INTO health_daily (guild_id, day, joins) VALUES (?, ?, 1)
    ON CONFLICT(guild_id, day) DO UPDATE SET joins = joins + 1`),
  leave: db.prepare(`INSERT INTO health_daily (guild_id, day, leaves) VALUES (?, ?, 1)
    ON CONFLICT(guild_id, day) DO UPDATE SET leaves = leaves + 1`),
  activatedDay: db.prepare(`INSERT INTO health_daily (guild_id, day, activated) VALUES (?, ?, 1)
    ON CONFLICT(guild_id, day) DO UPDATE SET activated = activated + 1`),
  newMember: db.prepare('INSERT OR REPLACE INTO health_new_members (guild_id, user_id, joined_at, activated) VALUES (?, ?, ?, 0)'),
  getNew: db.prepare('SELECT joined_at, activated FROM health_new_members WHERE guild_id = ? AND user_id = ?'),
  markActive: db.prepare('UPDATE health_new_members SET activated = 1 WHERE guild_id = ? AND user_id = ? AND activated = 0'),
  channelAdd: db.prepare(`INSERT INTO health_channel_day (guild_id, channel_id, day, messages) VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, channel_id, day) DO UPDATE SET messages = messages + excluded.messages`),
  addQuestion: db.prepare('INSERT OR IGNORE INTO health_questions (guild_id, channel_id, message_id, author_id, created_at, answered) VALUES (?, ?, ?, ?, ?, 0)'),
  answer: db.prepare('UPDATE health_questions SET answered = 1 WHERE guild_id = ? AND message_id = ? AND author_id != ?'),
  dailyRange: db.prepare('SELECT joins, leaves, activated FROM health_daily WHERE guild_id = ? AND day >= ? AND day <= ?'),
  channelRange: db.prepare('SELECT channel_id, SUM(messages) AS n FROM health_channel_day WHERE guild_id = ? AND day >= ? AND day <= ? GROUP BY channel_id'),
  questionsSince: db.prepare('SELECT guild_id, channel_id, message_id, created_at, answered FROM health_questions WHERE guild_id = ? AND created_at >= ? ORDER BY created_at ASC LIMIT 500'),
  pruneDaily: db.prepare('DELETE FROM health_daily WHERE day < ?'),
  pruneChannel: db.prepare('DELETE FROM health_channel_day WHERE day < ?'),
  pruneNew: db.prepare('DELETE FROM health_new_members WHERE joined_at < ?'),
  pruneQuestions: db.prepare('DELETE FROM health_questions WHERE created_at < ?'),
  countNew: db.prepare('SELECT COUNT(*) AS n FROM health_new_members WHERE guild_id = ?'),
};

// ---- config (store config table, key 'healthpost') ----
const CFG_KEY = 'healthpost';

function getConfig(guildId) {
  const raw = store.getConfig(guildId, CFG_KEY);
  const c = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: c.enabled === true,
    channelId: typeof c.channelId === 'string' ? c.channelId : null,
    helpChannels: Array.isArray(c.helpChannels) ? c.helpChannels.filter((x) => typeof x === 'string').slice(0, 25) : [],
    excluded: Array.isArray(c.excluded) ? c.excluded.filter((x) => typeof x === 'string').slice(0, 100) : [],
    since: Number.isFinite(c.since) ? c.since : null,
    lastPostAt: Number.isFinite(c.lastPostAt) ? c.lastPostAt : null,
  };
}

function setConfig(guildId, patch) {
  const next = { ...getConfig(guildId), ...patch };
  store.setConfig(guildId, CFG_KEY, next);
  return next;
}

// ---- buffered message counters (bounded by FLUSH_AT, flushed on a timer) ----
const pendingCounts = new Map(); // `${guildId}|${channelId}|${day}` -> n
let timer = null;

function flush() {
  if (!pendingCounts.size) return;
  const entries = [...pendingCounts];
  pendingCounts.clear();
  try {
    db.transaction(() => {
      for (const [key, n] of entries) {
        const [g, c, d] = key.split('|');
        stmts.channelAdd.run(g, c, d, n);
      }
    })();
  } catch (err) { log.error('healthstats flush failed:', err?.message || err); }
}

function ensureTimer() {
  if (timer) return;
  timer = setInterval(flush, FLUSH_MS);
  timer.unref?.();
}

function countMessage(guildId, channelId, now = Date.now()) {
  const key = `${guildId}|${channelId}|${H.dayKey(now)}`;
  pendingCounts.set(key, (pendingCounts.get(key) || 0) + 1);
  ensureTimer();
  if (pendingCounts.size >= FLUSH_AT) flush();
}

// ---- events ----
function recordJoin(guildId, userId, now = Date.now()) {
  db.transaction(() => {
    stmts.join.run(guildId, H.dayKey(now));
    if (stmts.countNew.get(guildId).n < MAX_NEW_PER_GUILD) stmts.newMember.run(guildId, userId, now);
  })();
}

function recordLeave(guildId, now = Date.now()) {
  stmts.leave.run(guildId, H.dayKey(now));
}

// First post or reaction by a new member inside the activation window. Returns true when it counted.
function recordActivity(guildId, userId, now = Date.now()) {
  const row = stmts.getNew.get(guildId, userId);
  if (!row || row.activated) return false;
  if (!H.isActivation(row.joined_at, now)) return false;
  let counted = false;
  db.transaction(() => {
    if (stmts.markActive.run(guildId, userId).changes) {
      stmts.activatedDay.run(guildId, H.dayKey(row.joined_at));
      counted = true;
    }
  })();
  return counted;
}

function recordQuestion(guildId, channelId, messageId, authorId, now = Date.now()) {
  stmts.addQuestion.run(guildId, channelId, messageId, String(authorId || ''), now);
}

// Only someone other than the asker can answer.
function markAnswered(guildId, messageId, replierId) {
  return stmts.answer.run(guildId, messageId, String(replierId || '')).changes > 0;
}

// ---- reading ----
function snapshot(guildId, now = Date.now()) {
  flush();
  const days = H.windowDays(now);
  const daily = stmts.dailyRange.all(guildId, days[0], days[days.length - 1]);
  const counts = {};
  for (const r of stmts.channelRange.all(guildId, days[0], days[days.length - 1])) counts[r.channel_id] = r.n;
  const questions = stmts.questionsSince.all(guildId, now - H.WINDOW_DAYS * H.DAY_MS).map((q) => ({
    guildId: q.guild_id, channelId: q.channel_id, messageId: q.message_id, createdAt: q.created_at, answered: !!q.answered,
  }));
  return { daily, counts, questions };
}

function prune(now = Date.now()) {
  stmts.pruneDaily.run(H.dayKey(now - KEEP_DAILY_DAYS * H.DAY_MS));
  stmts.pruneChannel.run(H.dayKey(now - KEEP_DAILY_DAYS * H.DAY_MS));
  stmts.pruneNew.run(now - KEEP_NEW_MEMBER_DAYS * H.DAY_MS);
  stmts.pruneQuestions.run(now - KEEP_QUESTION_DAYS * H.DAY_MS);
}

module.exports = {
  getConfig, setConfig, countMessage, flush, recordJoin, recordLeave, recordActivity, recordQuestion,
  markAnswered, snapshot, prune,
  KEEP_DAILY_DAYS, KEEP_NEW_MEMBER_DAYS, KEEP_QUESTION_DAYS, FLUSH_AT,
  _pending: pendingCounts,
};
