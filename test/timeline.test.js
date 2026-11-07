const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { create: createInf } = require('../src/database/infractions');
const { create: createAppeals } = require('../src/database/appeals');
const tl = require('../src/utils/timeline');
const presets = require('../src/utils/presets');
const appealH = require('../src/handlers/appeal');

const iso = (ms) => new Date(ms).toISOString();

test('timeline merges cases, warnings and notes newest first and dedupes store rows covered by a case', () => {
  const cases = [
    { case_id: 1, action: 'warn', created_at: 1_000_000, moderator_id: '111111111111111111', reason: 'spam' },
    { case_id: 2, action: 'mute', created_at: 2_000_000, moderator_id: '111111111111111111', reason: 'raid', duration: '1h' },
    { case_id: 3, action: 'note', created_at: 3_000_000, moderator_id: '111111111111111111', reason: null },
  ];
  const warnings = [
    { id: 7, moderator: '111111111111111111', reason: 'spam', timestamp: iso(1_000_500) }, // covered by case 1
    { id: 8, moderator: '222222222222222222', reason: 'old warn', timestamp: iso(500_000) }, // legacy, no case
  ];
  const notes = [{ id: 4, moderator: 'mod#0', content: 'watch this one', timestamp: iso(3_000_200) }];
  const out = tl.mergeTimeline({ cases, warnings, notes });
  assert.deepStrictEqual(out.map((e) => e.caseId), [3, 2, 1, null]);
  assert.strictEqual(out[0].reason, 'watch this one'); // note text comes from the notes table
  assert.strictEqual(out[3].kind, 'warning');
  assert.ok(!out.some((e) => e.refId === 7));
});

test('a note case whose note was removed says so instead of keeping text', () => {
  const out = tl.mergeTimeline({ cases: [{ case_id: 1, action: 'note', created_at: 5, reason: null }] });
  assert.strictEqual(out[0].reason, '(note removed)');
});

test('timeline field always fits a Discord field and counts what it left out', () => {
  const cases = Array.from({ length: 40 }, (_, i) => ({ case_id: i + 1, action: 'warn', created_at: 1000 + i, moderator_id: '111111111111111111', reason: 'x'.repeat(500) }));
  const f = tl.timelineField(tl.mergeTimeline({ cases }), { limit: 40 });
  assert.ok(f.value.length <= 1024);
  assert.match(f.value, /older/);
  assert.strictEqual(tl.timelineField([]).value, 'Nothing recorded for this member.');
});

test('renderTimelineField reads through deps and never throws', () => {
  const deps = {
    infractions: { casesFor: () => [{ case_id: 9, action: 'ban', created_at: 1, reason: 'r' }] },
    store: { getWarnings: () => [], getNotes: () => [] },
  };
  assert.match(tl.renderTimelineField('g', 'u', { deps }).value, /#9/);
  assert.strictEqual(tl.renderTimelineField('g', 'u', { deps: { infractions: { casesFor() { throw new Error('x'); } }, store: {} } }), null);
});

test('presets: validate, store round trip, lookup, consistency', () => {
  const ok = presets.addToTable({}, 'Spam', { action: 'mute', duration: '1h', reason: 'Spamming' });
  assert.strictEqual(ok.name, 'spam');
  assert.strictEqual(ok.preset.durationMs, 3600000);
  assert.ok(presets.addToTable({}, 'x', { action: 'mute', duration: 'none' }).error);
  assert.ok(presets.addToTable({}, 'x', { action: 'mute', duration: '60d' }).error);
  assert.ok(presets.addToTable({}, 'x', { action: 'ban', duration: '1h' }).error);
  assert.ok(presets.addToTable({}, 'bad name!', { action: 'warn', duration: 'none' }).error);
  assert.ok(presets.addToTable({}, 'x', { action: 'explode', duration: 'none' }).error);

  const cfg = new Map();
  const store = { getConfig: (g, k) => cfg.get(`${g}:${k}`) ?? null, setConfig: (g, k, v) => (v === null ? cfg.delete(`${g}:${k}`) : cfg.set(`${g}:${k}`, JSON.parse(JSON.stringify(v)))) };
  presets.savePresets('g', ok.table, { store });
  presets.savePresets('g', presets.addToTable(presets.listPresets('g', { store }), 'slur', { action: 'tempban', duration: '7d' }).table, { store });
  const p = presets.getPreset('g', ' SPAM ', { store });
  assert.deepStrictEqual(p, { action: 'mute', durationMs: 3600000, reason: 'Spamming' });
  assert.strictEqual(presets.getPreset('g', 'nope', { store }), null);
  assert.strictEqual(presets.getPreset('other', 'spam', { store }), null);

  assert.strictEqual(presets.checkConsistency(p, { action: 'mute', durationMs: 3600000 }).consistent, true);
  assert.match(presets.checkConsistency(p, { action: 'mute', durationMs: 86400000 }).differences[0], /1h/);
  assert.match(presets.checkConsistency(p, { action: 'kick' }).differences[0], /preset says mute/);
  assert.strictEqual(presets.checkConsistency(null, { action: 'ban' }).consistent, true);

  const removed = presets.removeFromTable(presets.listPresets('g', { store }), 'spam');
  assert.ok(!('spam' in removed.table));
  assert.ok(presets.removeFromTable({}, 'spam').error);
});

test('presets: hand-edited config values are cleaned, not trusted', () => {
  const t = presets.cleanTable({ ok: { action: 'warn', durationMs: null }, bad: { action: 'nuke' }, 'Bad Name': { action: 'warn' }, m: { action: 'mute', durationMs: 5 } });
  assert.deepStrictEqual(Object.keys(t), ['ok']);
  assert.deepStrictEqual(presets.cleanTable('junk'), {});
});

test('appeals: one open per case, denial cooldown, approved is final, atomic resolve', () => {
  const a = createAppeals(new Database(':memory:'));
  const id = a.openAppeal({ guildId: 'g', caseId: 5, userId: 'u', reason: 'please' , now: 1000 });
  assert.strictEqual(id, 1);
  assert.strictEqual(a.openAppeal({ guildId: 'g', caseId: 5, userId: 'u', reason: 'again', now: 1001 }), null);
  assert.match(a.blockReason('g', 5, 1002), /open appeal/);
  assert.strictEqual(a.openAppeal({ guildId: 'g', caseId: 6, userId: 'u', reason: 'other case' }), 2);
  assert.strictEqual(a.openAppeal({ guildId: 'g2', caseId: 5, userId: 'u', reason: 'other guild' }), 1);

  assert.strictEqual(a.resolve('g', 1, 'denied', 'mod', 2000).status, 'denied');
  assert.strictEqual(a.resolve('g', 1, 'approved', 'mod2', 2001), null); // already decided
  assert.match(a.blockReason('g', 5, 3000), /denied/);
  assert.strictEqual(a.blockReason('g', 5, 2000 + 8 * 86400000), null);
  assert.ok(a.openAppeal({ guildId: 'g', caseId: 5, userId: 'u', reason: 'after cooldown', now: 2000 + 8 * 86400000 }));

  a.resolve('g', 2, 'approved', 'mod', 4000);
  assert.match(a.blockReason('g', 6, 5000), /approved/);
  assert.strictEqual(a.reopen('g', 2, 'someone-else'), false);
  assert.strictEqual(a.reopen('g', 2, 'mod'), true);
  assert.strictEqual(a.getAppeal('g', 2).status, 'pending');
  assert.strictEqual(a.discard('g', 2), true);
  assert.strictEqual(a.blockReason('g', 6, 6000), null);
});

test('appeal rules: ownership, appealable actions, self-approval', () => {
  const c = { case_id: 3, target_id: 'u1', action: 'mute', status: 'active', moderator_id: 'm1' };
  assert.strictEqual(appealH.eligibilityProblem(c, 'u1'), null);
  assert.match(appealH.eligibilityProblem(c, 'u2'), /no case/);
  assert.match(appealH.eligibilityProblem(null, 'u1'), /no case/);
  assert.match(appealH.eligibilityProblem({ ...c, action: 'warn' }, 'u1'), /mute and tempban/);
  assert.match(appealH.eligibilityProblem({ ...c, status: 'void' }, 'u1'), /did not go through/);

  const appeal = { user_id: 'u1' };
  assert.match(appealH.approvalProblem(appeal, c, 'm1'), /different moderator/);
  assert.match(appealH.approvalProblem(appeal, c, 'u1'), /own appeal/);
  assert.strictEqual(appealH.approvalProblem(appeal, c, 'm2'), null);
  assert.deepStrictEqual(appealH.parseId('appeal:a:12'), { verb: 'a', id: 12 });
  assert.strictEqual(appealH.parseId('appeal:x:1'), null);
});

// Button flow with fakes: no Discord, no database file.
function fakeFlow({ action = 'mute', issuer = 'm1' } = {}) {
  const inf = createInf(new Database(':memory:'));
  const ap = createAppeals(new Database(':memory:'));
  const caseId = inf.openCase({ guildId: 'g', action, targetId: 'u1', targetTag: 'u1#0', moderatorId: issuer, duration: '1h' });
  if (action === 'tempban') inf.addTempban({ guildId: 'g', userId: 'u1', expiresAt: Date.now() + 1e6, caseId });
  const id = ap.openAppeal({ guildId: 'g', caseId, userId: 'u1', userTag: 'u1#0', reason: 'sorry' });
  const calls = { timeout: 0, unban: 0, replies: [], updates: 0 };
  const member = { isCommunicationDisabled: () => true, timeout: async () => { calls.timeout++; } };
  const guild = {
    id: 'g', name: 'G', client: { users: { fetch: async () => ({ send: async () => {} }) } },
    members: { cache: new Map([['u1', member]]), fetch: async () => member, unban: async () => { calls.unban++; } },
  };
  const modlog = { openCase: (g, row) => inf.openCase({ guildId: g.id, action: row.action, targetId: row.target.id, moderatorId: row.moderator.id, reason: row.reason }) };
  const press = (verb, userId, perms = true) => appealH.handleButton({
    customId: `appeal:${verb}:${id}`, guild, user: { id: userId, tag: `${userId}#0` }, client: { user: { id: 'bot' } },
    memberPermissions: { has: () => perms },
    reply: async (d) => { calls.replies.push(d.embeds[0].data.description); },
    update: async () => { calls.updates++; },
  }, { appeals: ap, infractions: inf, modlog });
  return { inf, ap, id, calls, press };
}

test('button: issuer cannot approve, a different moderator can, and the mute is lifted and logged', async () => {
  const f = fakeFlow();
  await f.press('a', 'm1');
  assert.match(f.calls.replies.at(-1), /different moderator/);
  assert.strictEqual(f.calls.timeout, 0);
  assert.strictEqual(f.ap.getAppeal('g', f.id).status, 'pending');

  await f.press('a', 'm2', false);
  assert.match(f.calls.replies.at(-1), /permission/);

  await f.press('a', 'm2');
  assert.strictEqual(f.calls.timeout, 1);
  assert.strictEqual(f.ap.getAppeal('g', f.id).status, 'approved');
  assert.ok(f.inf.casesFor('g', 'u1').some((c) => c.action === 'appeal-approved' && c.moderator_id === 'm2'));

  await f.press('a', 'm3'); // double decision
  assert.match(f.calls.replies.at(-1), /already approved/);
  assert.strictEqual(f.calls.timeout, 1);
});

test('button: approving a tempban unbans and clears the tempban row; denying changes nothing', async () => {
  const f = fakeFlow({ action: 'tempban' });
  await f.press('a', 'm2');
  assert.strictEqual(f.calls.unban, 1);
  assert.strictEqual(f.inf.getTempban('g', 'u1'), null);

  const d = fakeFlow();
  await d.press('d', 'm1'); // the issuer may deny
  assert.strictEqual(d.ap.getAppeal('g', d.id).status, 'denied');
  assert.strictEqual(d.calls.timeout, 0);
  assert.ok(d.inf.casesFor('g', 'u1').some((c) => c.action === 'appeal-denied'));
});
