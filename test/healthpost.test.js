const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../src/utils/healthpost');

const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
const DAY = H.DAY_MS;

test('isQuestion: ends with a question mark after trimming, nothing else', () => {
  assert.strictEqual(H.isQuestion('how do I do this?'), true);
  assert.strictEqual(H.isQuestion('  really?  \n'), true);
  assert.strictEqual(H.isQuestion('what? never mind'), false);
  assert.strictEqual(H.isQuestion(''), false);
  assert.strictEqual(H.isQuestion(null), false);
});

test('isActivation: only inside the window after joining', () => {
  assert.strictEqual(H.isActivation(NOW, NOW + 1000), true);
  assert.strictEqual(H.isActivation(NOW, NOW + H.ACTIVATION_MS), true);
  assert.strictEqual(H.isActivation(NOW, NOW + H.ACTIVATION_MS + 1), false);
  assert.strictEqual(H.isActivation(NOW, NOW - 1), false);
  assert.strictEqual(H.isActivation(undefined, NOW), false);
});

test('windowDays: 7 UTC keys ending today, oldest first', () => {
  const d = H.windowDays(NOW);
  assert.strictEqual(d.length, 7);
  assert.strictEqual(d[6], '2026-11-08');
  assert.strictEqual(d[0], '2026-11-02');
});

test('sumDaily: totals, ignores junk, activated capped at joins', () => {
  assert.deepStrictEqual(H.sumDaily([{ joins: 2, leaves: 1, activated: 1 }, { joins: 1, leaves: 0, activated: 5 }, { joins: -3, leaves: 'x' }]),
    { joins: 3, leaves: 1, activated: 3 });
  assert.deepStrictEqual(H.sumDaily(null), { joins: 0, leaves: 0, activated: 0 });
});

test('quietChannels: threshold, exclusions, new channels, order and limit', () => {
  const old = NOW - 30 * DAY;
  const channels = [
    { id: 'a', name: 'alpha', createdAt: old }, { id: 'b', name: 'beta', createdAt: old },
    { id: 'c', name: 'gamma', createdAt: old }, { id: 'd', name: 'delta', createdAt: old },
    { id: 'e', name: 'busy', createdAt: old }, { id: 'f', name: 'fresh', createdAt: NOW - DAY },
    { id: 'g', name: 'skipme', createdAt: old },
  ];
  const counts = { a: 3, b: 0, c: 1, d: 3, e: 50, f: 0, g: 0 };
  const q = H.quietChannels({ channels, counts, excluded: ['g'], now: NOW });
  assert.deepStrictEqual(q.map((c) => c.id), ['b', 'c', 'a']); // fewest messages first, ties by name, capped at 3
});

test('unansweredQuestions: skips answered, too fresh, too old; oldest first; bounded', () => {
  const mk = (id, age, answered = false) => ({ guildId: 'g', channelId: 'c', messageId: id, createdAt: NOW - age, answered });
  const qs = [mk('new', 1000), mk('ok2', 5 * DAY), mk('done', 2 * DAY, true), mk('ok1', 6 * DAY), mk('old', 9 * DAY), mk('ok3', 2 * H.QUESTION_MIN_AGE_MS)];
  const r = H.unansweredQuestions({ questions: qs, now: NOW, limit: 2 });
  assert.strictEqual(r.total, 3);
  assert.deepStrictEqual(r.shown.map((q) => q.messageId), ['ok1', 'ok2']);
  assert.strictEqual(H.jumpLink(r.shown[0]), 'https://discord.com/channels/g/c/ok1');
});

test('suggestions: at most 3, phrased as proposals', () => {
  const s = H.suggestions({
    totals: { joins: 10, leaves: 20, activated: 1 }, quiet: [{ id: 'a', name: 'lounge', messages: 0 }],
    unanswered: { total: 2, shown: [] }, helpChannelCount: 0,
  });
  assert.strictEqual(s.length, H.MAX_SUGGESTIONS);
  assert.ok(s.every((x) => /^Consider /.test(x)));
  assert.deepStrictEqual(H.suggestions({ totals: { joins: 0, leaves: 0, activated: 0 }, quiet: [], unanswered: { total: 0 }, helpChannelCount: 1 }), []);
});

function sampleReport(over = {}) {
  return H.buildReport({
    now: NOW,
    daily: [{ joins: 4, leaves: 2, activated: 3 }],
    counts: { a: 1, b: 40 },
    channels: [{ id: 'a', name: 'alpha', createdAt: NOW - 30 * DAY }, { id: 'b', name: 'busy', createdAt: NOW - 30 * DAY }],
    excluded: [],
    questions: [{ guildId: 'g', channelId: 'h', messageId: 'm1', createdAt: NOW - 3 * DAY, answered: false }],
    helpChannelCount: 1,
    since: NOW - 20 * DAY,
    ...over,
  });
}

test('renderEmbed: wording, footer, jump links, no retained claim', () => {
  const embed = H.renderEmbed(null, sampleReport(), { guildName: 'Test' }).toJSON();
  const text = JSON.stringify(embed);
  assert.match(embed.footer.text, /counts only, no message text stored/);
  assert.match(text, /Posted again/);
  assert.match(text, /3 of 4 new members \(75%\)/);
  assert.doesNotMatch(text, /retain/i);
  assert.match(text, /https:\/\/discord\.com\/channels\/g\/h\/m1/);
  assert.match(text, /<#a> - 1 message/);
});

test('renderEmbed: no percentage for tiny join counts, partial week noted, no help channels noted', () => {
  const embed = H.renderEmbed(null, sampleReport({ daily: [{ joins: 2, leaves: 0, activated: 1 }], since: NOW - 2 * DAY, helpChannelCount: 0, questions: [] })).toJSON();
  const text = JSON.stringify(embed);
  assert.doesNotMatch(text, /\d+%/);
  assert.match(text, /less than a full week/);
  assert.match(text, /No help channels chosen/);
});

test('renderEmbed: more than the shown questions says how many remain', () => {
  const questions = Array.from({ length: 8 }, (_, i) => ({ guildId: 'g', channelId: 'h', messageId: `m${i}`, createdAt: NOW - (i + 2) * 3 * H.QUESTION_MIN_AGE_MS, answered: false }));
  const text = JSON.stringify(H.renderEmbed(null, sampleReport({ questions })).toJSON());
  assert.match(text, /Unanswered questions \(8\)/);
  assert.match(text, /and 3 more/);
});

test('storage schema and listener keep no message text', () => {
  const db = fs.readFileSync(path.join(__dirname, '..', 'src', 'database', 'healthstats.js'), 'utf8');
  assert.doesNotMatch(db, /(content|text|body)\s+TEXT/i);
  const ev = fs.readFileSync(path.join(__dirname, '..', 'src', 'events', 'healthCount.js'), 'utf8');
  assert.doesNotMatch(ev, /recordQuestion\([^)]*content/);
});

test('storage: counters, activation window, answering', () => {
  const S = require('../src/database/healthstats');
  const g = `test-health-${Date.now()}`;
  const t0 = Date.now();
  S.recordJoin(g, 'u1', t0); S.recordJoin(g, 'u2', t0); S.recordLeave(g, t0);
  assert.strictEqual(S.recordActivity(g, 'u1', t0 + 1000), true);
  assert.strictEqual(S.recordActivity(g, 'u1', t0 + 2000), false); // only once
  assert.strictEqual(S.recordActivity(g, 'u2', t0 + H.ACTIVATION_MS + 5000), false); // too late
  assert.strictEqual(S.recordActivity(g, 'stranger', t0), false);
  S.countMessage(g, 'c1', t0); S.countMessage(g, 'c1', t0); S.countMessage(g, 'c2', t0);
  S.recordQuestion(g, 'help', 'q1', 'asker', t0 - 2 * H.QUESTION_MIN_AGE_MS);
  S.recordQuestion(g, 'help', 'q2', 'asker', t0 - 2 * H.QUESTION_MIN_AGE_MS);
  assert.strictEqual(S.markAnswered(g, 'q1', 'asker'), false); // the asker cannot answer themselves
  assert.strictEqual(S.markAnswered(g, 'q1', 'helper'), true);
  const snap = S.snapshot(g, t0);
  assert.deepStrictEqual(H.sumDaily(snap.daily), { joins: 2, leaves: 1, activated: 1 });
  assert.deepStrictEqual(snap.counts, { c1: 2, c2: 1 });
  assert.strictEqual(snap.questions.filter((q) => !q.answered).length, 1);
  const { db } = require('../src/database/store');
  for (const tbl of ['health_daily', 'health_channel_day', 'health_new_members', 'health_questions']) db.prepare(`DELETE FROM ${tbl} WHERE guild_id = ?`).run(g);
});

test('config defaults OFF and prune runs', () => {
  const S = require('../src/database/healthstats');
  const cfg = S.getConfig('never-configured-guild');
  assert.strictEqual(cfg.enabled, false);
  assert.strictEqual(cfg.channelId, null);
  assert.doesNotThrow(() => S.prune());
});

test('isDue: needs on + channel and a full window since last post or since enabling', () => {
  const run = require('../src/utils/healthpostRun');
  const base = { enabled: true, channelId: 'c', since: NOW - 8 * DAY, lastPostAt: null };
  assert.strictEqual(run.isDue(base, NOW), true);
  assert.strictEqual(run.isDue({ ...base, since: NOW - 3 * DAY }, NOW), false);
  assert.strictEqual(run.isDue({ ...base, lastPostAt: NOW - 2 * DAY }, NOW), false);
  assert.strictEqual(run.isDue({ ...base, enabled: false }, NOW), false);
  assert.strictEqual(run.isDue({ ...base, channelId: null }, NOW), false);
});
