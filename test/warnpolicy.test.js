const test = require('node:test');
const assert = require('node:assert');
const p = require('../src/utils/warnpolicy');

const DAY = 86400000;

test('validateThreshold accepts good input and fills the mute default', () => {
  assert.deepStrictEqual(p.validateThreshold({ count: 3, action: 'mute' }).value, { count: 3, action: 'mute', durationMs: 3600000 });
  assert.deepStrictEqual(p.validateThreshold({ count: 5, action: 'BAN', duration: '7d' }).value, { count: 5, action: 'ban', durationMs: 7 * DAY });
  assert.strictEqual(p.validateThreshold({ count: 4, action: 'kick' }).value.durationMs, null);
});

test('validateThreshold rejects bad counts, actions and durations', () => {
  for (const bad of [
    { count: 0, action: 'mute' }, { count: 101, action: 'mute' }, { count: 1.5, action: 'kick' },
    { count: 2, action: 'explode' }, { count: 2, action: 'kick', duration: '1h' },
    { count: 2, action: 'mute', duration: '29d' }, { count: 2, action: 'mute', duration: 'soon' },
    { count: 2, action: 'ban', duration: '400d' }, { count: 2, action: 'mute', duration: '10s' },
  ]) assert.ok(p.validateThreshold(bad).error, JSON.stringify(bad));
});

test('normalizeThresholds drops junk, de-duplicates by count, sorts, caps at 10', () => {
  const raw = [{ count: 5, action: 'kick' }, null, 'x', { count: 3, action: 'mute', durationMs: 60000 }, { count: 5, action: 'ban' }, { count: 2, action: 'nope' }];
  assert.deepStrictEqual(p.normalizeThresholds(raw), [
    { count: 3, action: 'mute', durationMs: 60000 },
    { count: 5, action: 'ban', durationMs: null },
  ]);
  assert.strictEqual(p.normalizeThresholds(Array.from({ length: 30 }, (_, i) => ({ count: i + 1, action: 'kick' }))).length, 10);
  assert.deepStrictEqual(p.normalizeThresholds('garbage'), []);
  // a stored mute longer than Discord allows is clamped, never passed through
  assert.strictEqual(p.normalizeThresholds([{ count: 1, action: 'mute', durationMs: 99 * DAY }])[0].durationMs, 28 * DAY);
});

test('pickThreshold fires only on an exact active-warning count', () => {
  const t = [{ count: 3, action: 'mute' }, { count: 5, action: 'kick' }, { count: 7, action: 'ban' }];
  assert.strictEqual(p.pickThreshold(t, 2), null);
  assert.strictEqual(p.pickThreshold(t, 3).action, 'mute');
  assert.strictEqual(p.pickThreshold(t, 4), null); // between thresholds: nothing extra
  assert.strictEqual(p.pickThreshold(t, 5).action, 'kick');
  assert.strictEqual(p.pickThreshold(t, 6), null);
  assert.strictEqual(p.pickThreshold(t, 7).action, 'ban');
  assert.strictEqual(p.pickThreshold(t, 50), null);
  assert.strictEqual(p.pickThreshold([{ count: 2, action: 'none' }, { count: 1, action: 'mute' }], 2).action, 'none');
});

test('expiry dropping below a threshold lets it fire again on the way back up', () => {
  const t = [{ count: 3, action: 'mute' }];
  const now = 100 * DAY;
  const at = (d) => ({ timestamp: new Date(now - d * DAY).toISOString() });
  // 3 warnings, one 40 days old: with 30-day expiry only 2 count, so no fire
  assert.strictEqual(p.pickThreshold(t, p.countActive([at(1), at(2), at(40)], 30, now)), null);
  // a new warning brings the active count back to exactly 3
  assert.strictEqual(p.pickThreshold(t, p.countActive([at(0), at(1), at(2), at(40)], 30, now)).action, 'mute');
});

test('countActive honours warn_expiry_days', () => {
  const now = 100 * DAY;
  const w = [{ timestamp: new Date(now - 1 * DAY).toISOString() }, { timestamp: new Date(now - 40 * DAY).toISOString() }, { timestamp: 'bad' }];
  assert.strictEqual(p.countActive(w, null, now), 3);
  assert.strictEqual(p.countActive(w, 30, now), 2); // unparseable date keeps counting
  assert.strictEqual(p.countActive(w, 0, now), 3);
  assert.strictEqual(p.countActive(w, 'abc', now), 3);
  assert.strictEqual(p.countActive(null, 30, now), 0);
});

// --- fakes for applyThreshold ---
function fakeGuild({ ownerId = 'owner', botBan = true } = {}) {
  const calls = [];
  const guild = {
    id: 'g', ownerId, name: 'Test',
    client: { user: { id: 'bot', tag: 'Sonder#0001' } },
    members: {
      cache: new Map(),
      fetch: async () => { throw new Error('unknown member'); },
      ban: async (id, opts) => { calls.push(['ban', id, opts.reason]); },
      me: { permissions: { has: () => botBan } },
    },
  };
  return { guild, calls };
}
function fakeMember(id, { pos = 1, moderatable = true, kickable = true, bannable = true, fail = false } = {}, calls) {
  return {
    id, moderatable, kickable, bannable, manageable: moderatable,
    roles: { highest: { position: pos } },
    timeout: async (ms, reason) => { if (fail) throw new Error('Missing Permissions'); calls.push(['timeout', id, ms, reason]); },
    kick: async (reason) => { if (fail) throw new Error('Missing Permissions'); calls.push(['kick', id, reason]); },
  };
}
function fakeDeps() {
  const log = { opened: [], voided: [], sent: [], tempbans: [] };
  let n = 0;
  return {
    log,
    deps: {
      modlog: {
        openCase: (g, c) => { log.opened.push(c); return ++n; },
        voidCase: (g, id) => { log.voided.push(id); },
        send: async (g, e) => { log.sent.push(e); return e.caseId; },
      },
      infractions: { addTempban: (t) => log.tempbans.push(t) },
      dm: async () => {},
    },
  };
}
const user = (id) => ({ id, tag: `${id}#0001`, send: async () => {} });
const mod = (pos = 10) => ({ id: 'mod', roles: { highest: { position: pos } } });

test('applyThreshold mutes with an Auto reason and a case', async () => {
  const { guild, calls } = fakeGuild();
  guild.members.cache.set('u', fakeMember('u', {}, calls));
  const { deps, log } = fakeDeps();
  const r = await p.applyThreshold({ guild, user: user('u'), invoker: mod(), count: 3, threshold: { count: 3, action: 'mute', durationMs: 3600000 }, deps });
  assert.ok(r.applied);
  assert.deepStrictEqual(calls[0], ['timeout', 'u', 3600000, 'Auto: 3 warnings']);
  assert.strictEqual(log.opened[0].reason, 'Auto: 3 warnings');
  assert.strictEqual(log.sent[0].caseId, 1);
  assert.match(r.text, /case #1/);
});

test('applyThreshold never acts on the owner, someone above the bot, or above the warning moderator', async () => {
  const { guild, calls } = fakeGuild({ ownerId: 'u' });
  guild.members.cache.set('u', fakeMember('u', {}, calls));
  let r = await p.applyThreshold({ guild, user: user('u'), invoker: mod(), count: 5, threshold: { count: 5, action: 'ban' }, deps: fakeDeps().deps });
  assert.ok(!r.applied); assert.match(r.text, /own the server/);

  const g2 = fakeGuild();
  g2.guild.members.cache.set('u', fakeMember('u', { kickable: false }, g2.calls));
  r = await p.applyThreshold({ guild: g2.guild, user: user('u'), invoker: mod(), count: 5, threshold: { count: 5, action: 'kick' }, deps: fakeDeps().deps });
  assert.ok(!r.applied); assert.match(r.text, /above mine/);

  const g3 = fakeGuild();
  g3.guild.members.cache.set('u', fakeMember('u', { pos: 20 }, g3.calls));
  r = await p.applyThreshold({ guild: g3.guild, user: user('u'), invoker: mod(10), count: 5, threshold: { count: 5, action: 'kick' }, deps: fakeDeps().deps });
  assert.ok(!r.applied); assert.match(r.text, /warning moderator/);
  assert.strictEqual(g2.calls.length + g3.calls.length + calls.length, 0);
});

test('applyThreshold: timed ban schedules a tempban; a member who left can still be banned', async () => {
  const { guild, calls } = fakeGuild();
  const { deps, log } = fakeDeps();
  const r = await p.applyThreshold({ guild, user: user('gone'), invoker: mod(), count: 7, threshold: { count: 7, action: 'ban', durationMs: DAY }, deps });
  assert.ok(r.applied, r.text);
  assert.strictEqual(calls[0][0], 'ban');
  assert.strictEqual(log.tempbans[0].userId, 'gone');
  assert.strictEqual(log.opened[0].action, 'tempban');
});

test('applyThreshold: a refused action voids the case and does not throw', async () => {
  const { guild, calls } = fakeGuild();
  guild.members.cache.set('u', fakeMember('u', { fail: true }, calls));
  const { deps, log } = fakeDeps();
  const r = await p.applyThreshold({ guild, user: user('u'), invoker: mod(), count: 3, threshold: { count: 3, action: 'mute', durationMs: 60000 }, deps });
  assert.ok(!r.applied);
  assert.deepStrictEqual(log.voided, [1]);
  assert.match(r.text, /failed/);
});

test('applyThreshold with none / no threshold does nothing', async () => {
  const { guild } = fakeGuild();
  assert.strictEqual((await p.applyThreshold({ guild, user: user('u'), count: 1, threshold: { count: 1, action: 'none' } })).applied, false);
  assert.strictEqual((await p.applyThreshold({ guild, user: user('u'), count: 1, threshold: null })).applied, false);
});
