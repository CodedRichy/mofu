const test = require('node:test');
const assert = require('node:assert');
const store = require('../src/database/store');

const G = 'test-guild-cache';
test.after(() => { store.setConfig(G, 'k', null); store.setConfig(G, 'arr', null); });

test('config round-trips and caches misses', () => {
  assert.strictEqual(store.getConfig(G, 'k'), null);
  store.setConfig(G, 'k', { a: 1 });
  assert.deepStrictEqual(store.getConfig(G, 'k'), { a: 1 });
  store.setConfig(G, 'k', null);
  assert.strictEqual(store.getConfig(G, 'k'), null);
});

test('mutating a returned value does not corrupt the cache', () => {
  store.setConfig(G, 'arr', ['x']);
  store.getConfig(G, 'arr').push('y');
  assert.deepStrictEqual(store.getConfig(G, 'arr'), ['x']);
});

test('warnings keep their issuer whichever field name the caller used', () => {
  const g = 'test-guild-warn-issuer';
  store.addWarning(g, 'u1', { moderatorId: 'mod-a', reason: 'one' });
  store.addWarning(g, 'u1', { moderator: 'mod-b', reason: 'two' });
  const w = store.getWarnings(g, 'u1');
  assert.deepStrictEqual(w.map((x) => x.moderator).sort(), ['mod-a', 'mod-b']);
  assert.ok(w.every((x) => x.moderatorId === x.moderator));
  store.db.prepare('DELETE FROM warnings WHERE guild_id = ?').run(g);
});
