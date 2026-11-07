const test = require('node:test');
const assert = require('node:assert');
const c = require('../src/utils/crowns');

const m = (userId, lastActive, extra = {}) => ({ userId, username: `u${userId}`, lastActive, hidden: false, ...extra });

test('artistKey normalizes case and spacing', () => {
  assert.strictEqual(c.artistKey('  Radio   HEAD '), 'radio head');
});

test('pickLookupTargets: most recent first, cap, hidden and absent dropped', () => {
  const members = [m('a', 1), m('b', 5), m('c', 3), m('d', 9, { hidden: true }), m('e', 0), m('f', 7)];
  const t = c.pickLookupTargets(members, { cap: 3, isPresent: (id) => id !== 'f' });
  assert.deepStrictEqual(t.map((x) => x.userId), ['b', 'c', 'a']);
});

test('pickLookupTargets caps at 25 by default and is stable on ties', () => {
  const many = Array.from({ length: 40 }, (_, i) => m(String(100 + i), 0));
  const t = c.pickLookupTargets(many);
  assert.strictEqual(t.length, c.LOOKUP_CAP);
  assert.strictEqual(t[0].userId, '100');
});

test('rankListeners sorts desc, drops zero and bad values, ties by id', () => {
  const r = c.rankListeners([
    { userId: 'b', plays: 10 }, { userId: 'a', plays: 10 }, { userId: 'z', plays: 0 },
    { userId: 'y', plays: NaN }, { userId: 'x', plays: 50 },
  ]);
  assert.deepStrictEqual(r.map((e) => e.userId), ['x', 'a', 'b']);
});

test('collectPlays gathers entries and counts failures', async () => {
  const targets = [m('a', 1), m('b', 1), m('c', 1)];
  const res = await c.collectPlays(targets, async (t) => {
    if (t.userId === 'b') throw new Error('boom');
    return { plays: t.userId === 'a' ? 7 : 3, artist: 'Band' };
  });
  assert.strictEqual(res.checked, 2);
  assert.strictEqual(res.failed, 1);
  assert.strictEqual(res.aborted, false);
  assert.strictEqual(res.entries.length, 2);
});

test('collectPlays aborts on Last.fm unavailable and stops new lookups', async () => {
  const targets = Array.from({ length: 20 }, (_, i) => m(String(i), 1));
  let calls = 0;
  const res = await c.collectPlays(targets, async () => {
    calls++;
    const e = new Error('rate');
    e.code = 'LASTFM_UNAVAILABLE';
    throw e;
  }, { concurrency: 2 });
  assert.strictEqual(res.aborted, true);
  assert.ok(calls < 20);
  assert.strictEqual(res.failed, 0);
});

test('collectPlays with no targets', async () => {
  const res = await c.collectPlays([], async () => null);
  assert.deepStrictEqual(res, { entries: [], checked: 0, failed: 0, aborted: false });
});

test('cache expires after ttl and clears per guild', () => {
  let t = 1000;
  const cache = c.createCache({ ttl: 600, now: () => t });
  cache.set('g1', 'Artist', { v: 1 });
  cache.set('g2', 'artist', { v: 2 });
  assert.deepStrictEqual(cache.get('g1', ' ARTIST '), { v: 1 });
  t += 599;
  assert.ok(cache.get('g1', 'artist'));
  t += 1;
  assert.strictEqual(cache.get('g1', 'artist'), null);
  cache.clearGuild('g2');
  assert.strictEqual(cache.get('g2', 'artist'), null);
});

test('default cache ttl is 10 minutes', () => {
  assert.strictEqual(c.CACHE_TTL_MS, 600000);
});

test('applyLookup sets, replaces and removes crowns', () => {
  let cr = c.applyLookup({}, 'Band', [{ userId: 'a', plays: 40 }, { userId: 'b', plays: 9 }], { now: 1 });
  assert.strictEqual(cr.band.u, 'a');
  assert.strictEqual(cr.band.a, 'Band');
  cr = c.applyLookup(cr, 'band', [{ userId: 'b', plays: 60 }], { now: 2 });
  assert.strictEqual(cr.band.u, 'b');
  cr = c.applyLookup(cr, 'band', [{ userId: 'b', plays: c.MIN_CROWN_PLAYS - 1 }]);
  assert.strictEqual(cr.band, undefined);
});

test('applyLookup does not mutate input and trims oldest past max', () => {
  const base = { old: { a: 'Old', u: 'a', p: 9, t: 1 }, mid: { a: 'Mid', u: 'a', p: 9, t: 2 } };
  const out = c.applyLookup(base, 'New', [{ userId: 'b', plays: 10 }], { now: 3, max: 2 });
  assert.deepStrictEqual(Object.keys(out).sort(), ['mid', 'new']);
  assert.deepStrictEqual(Object.keys(base).sort(), ['mid', 'old']);
});

test('leaderboard, crownsOf, crownRoleHolder', () => {
  const cr = {
    x: { a: 'X', u: 'a', p: 10, t: 1 },
    y: { a: 'Y', u: 'a', p: 20, t: 1 },
    z: { a: 'Z', u: 'b', p: 500, t: 1 },
  };
  assert.deepStrictEqual(c.leaderboard(cr).map((e) => [e.userId, e.count]), [['a', 2], ['b', 1]]);
  assert.deepStrictEqual(c.crownsOf(cr, 'a').map((e) => e.a), ['Y', 'X']);
  assert.strictEqual(c.crownRoleHolder(cr), 'a');
  assert.strictEqual(c.crownRoleHolder({}), null);
});

test('crownRoleHolder tie breaks on total plays then id', () => {
  const cr = { x: { a: 'X', u: 'a', p: 10 }, y: { a: 'Y', u: 'b', p: 30 } };
  assert.strictEqual(c.crownRoleHolder(cr), 'b');
  const eq = { x: { a: 'X', u: 'b', p: 10 }, y: { a: 'Y', u: 'a', p: 10 } };
  assert.strictEqual(c.crownRoleHolder(eq), 'a');
});

test('dropHolders removes hidden or absent holders, role then goes to next', () => {
  const cr = { x: { a: 'X', u: 'a', p: 10 }, y: { a: 'Y', u: 'a', p: 10 }, z: { a: 'Z', u: 'b', p: 10 } };
  const live = c.dropHolders(cr, (id) => id === 'a');
  assert.deepStrictEqual(Object.keys(live), ['z']);
  assert.strictEqual(c.crownRoleHolder(live), 'b');
});
