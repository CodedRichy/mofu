const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');

// Point the xp module at a temp db before it loads (never the live db).
process.env.SONDER_XP_DB = path.join(os.tmpdir(), `sonder-xp-test-${process.pid}.db`);
const xp = require('../src/database/xp');

test('clampInt rejects non-numbers, negatives and unsafe ints', () => {
  for (const bad of ['5', null, undefined, NaN, Infinity, -1, 1.5, 2 ** 60]) {
    assert.throws(() => xp.clampInt(bad, 10, 'x'), RangeError);
  }
  assert.strictEqual(xp.clampInt(5, 10, 'x'), 5);
  assert.strictEqual(xp.clampInt(999, 10, 'x'), 10);
});

test('setLevel and setXp clamp huge values and stay fast', () => {
  const t = Date.now();
  assert.strictEqual(xp.setLevel('tg', 'u', 10 ** 9).level, xp.MAX_LEVEL);
  assert.ok(xp.setXp('tg', 'u', Number.MAX_SAFE_INTEGER).totalXp <= xp.MAX_XP);
  assert.ok(Date.now() - t < 2000);
  assert.throws(() => xp.setLevel('tg', 'u', -3), RangeError);
  assert.throws(() => xp.setXp('tg', 'u', '12'), RangeError);
});
