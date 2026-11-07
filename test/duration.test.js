const test = require('node:test');
const assert = require('node:assert');
const { parse, format } = require('../src/utils/duration');

test('format keeps two units so 90 minutes is not reported as 1h', () => {
  assert.strictEqual(format(90 * 60000), '1h 30m');
  assert.strictEqual(format(36 * 3600000), '1d 12h');
  assert.strictEqual(format(3600000), '1h');
  assert.strictEqual(format(61000), '1m 1s');
  assert.strictEqual(format(45000), '45s');
  assert.strictEqual(format(0), '0s');
});

test('parse and format round-trip for whole units', () => {
  for (const s of ['30m', '2h', '3d', '1w']) assert.strictEqual(typeof format(parse(s)), 'string');
  assert.strictEqual(parse('10 m'), 600000);
  assert.strictEqual(parse('abc'), null);
});
