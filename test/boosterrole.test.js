const test = require('node:test');
const assert = require('node:assert');
const { normalizeHex, cleanName, nameClash } = require('../src/commands/config/boosterrole');

test('normalizeHex accepts real colors and rejects junk', () => {
  assert.strictEqual(normalizeHex('#FF0000'), 'ff0000');
  assert.strictEqual(normalizeHex('f00'), 'ff0000');
  assert.strictEqual(normalizeHex('ff0000zz'), null);   // parseInt would have accepted this
  assert.strictEqual(normalizeHex('fffffffff'), null);  // would overflow Discord's 24-bit color
  assert.strictEqual(normalizeHex(''), null);
  assert.strictEqual(normalizeHex(undefined), null);
});

test('cleanName strips control chars, collapses whitespace, caps length', () => {
  assert.strictEqual(cleanName('  hello\u0000   world\n'), 'hello world');
  assert.strictEqual(cleanName('s'.repeat(50)).length, 32);
  assert.strictEqual(cleanName('assess'), 'assess'); // the letter s must survive
});

test('nameClash blocks impersonating an existing role but allows keeping your own', () => {
  const roles = [{ id: '1', name: 'Moderator' }, { id: '2', name: 'my pink role' }];
  const guild = { roles: { cache: { find: (fn) => roles.find(fn) } } };
  assert.match(nameClash(guild, 'moderator', null), /already exists/);
  assert.strictEqual(nameClash(guild, 'my pink role', '2'), null);
  assert.strictEqual(nameClash(guild, 'fresh name', null), null);
  assert.match(nameClash(guild, '', null), /at least one/);
});
