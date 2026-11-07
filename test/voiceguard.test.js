const test = require('node:test');
const assert = require('node:assert');
const g = require('../src/utils/voiceguard');

test('flap: fires on the Nth switch inside the window, not before, not after it expires', () => {
  const t = g.createTracker({ flapSwitches: 4, flapWindowMs: 1000 });
  assert.ok(!t.trackSwitch('g', 'u', 0));
  assert.ok(!t.trackSwitch('g', 'u', 100));
  assert.ok(!t.trackSwitch('g', 'u', 200));
  assert.ok(t.trackSwitch('g', 'u', 300));
  const slow = g.createTracker({ flapSwitches: 4, flapWindowMs: 1000 });
  for (let i = 0; i < 10; i++) assert.ok(!slow.trackSwitch('g', 'u', i * 600));
});

test('flap: members and guilds are counted separately', () => {
  const t = g.createTracker({ flapSwitches: 2, flapWindowMs: 1000 });
  assert.ok(!t.trackSwitch('g', 'a', 0));
  assert.ok(!t.trackSwitch('g', 'b', 1));
  assert.ok(!t.trackSwitch('h', 'a', 2));
  assert.ok(t.trackSwitch('g', 'a', 3));
});

test('raid: needs enough DISTINCT young accounts in one channel within the window', () => {
  const t = g.createTracker({ raidAccounts: 3, raidWindowMs: 1000 });
  assert.strictEqual(t.trackYoungJoin('g', 'c', 'u1', 0), null);
  assert.strictEqual(t.trackYoungJoin('g', 'c', 'u1', 10), null); // same account twice is one
  assert.strictEqual(t.trackYoungJoin('g', 'c', 'u2', 20), null);
  assert.strictEqual(t.trackYoungJoin('g', 'other', 'u3', 30), null); // different channel
  assert.deepStrictEqual(t.trackYoungJoin('g', 'c', 'u3', 40).sort(), ['u1', 'u2', 'u3']);
  const slow = g.createTracker({ raidAccounts: 3, raidWindowMs: 1000 });
  slow.trackYoungJoin('g', 'c', 'a', 0);
  slow.trackYoungJoin('g', 'c', 'b', 600);
  assert.strictEqual(slow.trackYoungJoin('g', 'c', 'c', 1300), null); // 'a' fell out of the window
});

test('isYoung: under 7 days only; bad input is not young', () => {
  const now = 10 * g.RAID_MAX_AGE_MS;
  assert.ok(g.isYoung(now - 1000, now));
  assert.ok(!g.isYoung(now - g.RAID_MAX_AGE_MS - 1, now));
  assert.ok(!g.isYoung(undefined, now));
  assert.ok(!g.isYoung(NaN, now));
});

test('alert cooldown: one alert per key per cooldown', () => {
  const t = g.createTracker({ cooldownMs: 1000 });
  assert.ok(t.alertAllowed('k', 0));
  assert.ok(!t.alertAllowed('k', 500));
  assert.ok(t.alertAllowed('other', 500));
  assert.ok(t.alertAllowed('k', 1000));
});

test('tracker memory stays bounded', () => {
  const t = g.createTracker({ flapWindowMs: 10 });
  for (let i = 0; i < 12000; i++) t.trackSwitch('g', `u${i}`, i * 100);
  assert.ok(t.size() <= 5001);
});

const fakeStore = (cfg) => ({ getConfig: (gid, k) => cfg[k] ?? null });
const state = (guild, member, channelId) => ({ guild, member, channelId });
const NOW = 1e12;
const mk = (id, age, bot = false) => ({ id, user: { bot, createdTimestamp: NOW - age } });

test('observe: off by default, silent unless voiceguard is true', () => {
  const guild = { id: 'g' };
  const trk = g.createTracker({ flapSwitches: 1 });
  const m = mk('u', 1000);
  assert.strictEqual(g.observe(state(guild, m, null), state(guild, m, 'c'), { store: fakeStore({}), trk, now: NOW }), null);
  assert.strictEqual(g.observe(state(guild, m, null), state(guild, m, 'c'), { store: fakeStore({ voiceguard: false }), trk, now: NOW }), null);
});

test('observe: flap proposes once, then the cooldown holds', () => {
  const guild = { id: 'g' };
  const trk = g.createTracker({ flapSwitches: 3, flapWindowMs: 1000, cooldownMs: 100000 });
  const store = fakeStore({ voiceguard: true });
  const m = mk('u', 100 * g.RAID_MAX_AGE_MS);
  const hop = (ch, now) => g.observe(state(guild, m, 'x'), state(guild, m, ch), { store, trk, now });
  assert.strictEqual(hop('a', NOW), null);
  assert.strictEqual(hop('b', NOW + 10), null);
  const f = hop('c', NOW + 20);
  assert.strictEqual(f.kind, 'flap');
  assert.deepStrictEqual(f.userIds, ['u']);
  assert.strictEqual(hop('d', NOW + 30), null);
  assert.strictEqual(hop('e', NOW + 40), null);
  assert.strictEqual(hop('f', NOW + 50), null); // third switch after the reset, held by the cooldown
});

test('observe: raid of young accounts; bots, old accounts and same-channel updates are ignored', () => {
  const guild = { id: 'g' };
  const trk = g.createTracker({ raidAccounts: 3, raidWindowMs: 5000, flapSwitches: 99 });
  const store = fakeStore({ voiceguard: true });
  const join = (m, ch = 'c', from = null) => g.observe(state(guild, m, from), state(guild, m, ch), { store, trk, now: NOW });
  assert.strictEqual(join(mk('o1', 30 * 86400000)), null);
  assert.strictEqual(join(mk('b1', 1000, true)), null);
  assert.strictEqual(join(mk('y1', 1000), 'c', 'c'), null);
  assert.strictEqual(join(mk('y1', 1000)), null);
  assert.strictEqual(join(mk('y2', 1000)), null);
  const r = join(mk('y3', 1000));
  assert.strictEqual(r.kind, 'raid');
  assert.deepStrictEqual(r.userIds.sort(), ['y1', 'y2', 'y3']);
  assert.strictEqual(r.channelId, 'c');
});

test('alertText names the channel and members and claims no action', () => {
  const a = g.alertText({ kind: 'flap', channelId: '9', userIds: ['1'] });
  assert.match(a, /<@1>/);
  assert.match(a, /<#9>/);
  assert.match(g.alertText({ kind: 'raid', channelId: '9', userIds: ['1', '2'] }), /2 accounts younger than 7 days/);
});

test('thresholds are sane constants', () => {
  assert.ok(g.FLAP_SWITCHES >= 3 && g.FLAP_WINDOW_MS <= 120000);
  assert.ok(g.RAID_ACCOUNTS >= 3);
  assert.strictEqual(g.RAID_MAX_AGE_MS, 7 * 86400000);
});
