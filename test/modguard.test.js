const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('../src/utils/modguard');

test('clip', () => {
  assert.equal(g.clip('abc', 5), 'abc');
  assert.equal(g.clip('abcdefghij', 6), 'abc...');
  assert.equal(g.clip(null, 5), '');
});

test('joinClipped never exceeds max', () => {
  const lines = Array.from({ length: 50 }, (_, i) => `line number ${i} `.repeat(5));
  const out = g.joinClipped(lines, 1024);
  assert.ok(out.length <= 1024);
  assert.match(out, /and \d+ more$/);
  assert.equal(g.joinClipped(['a', 'b'], 100), 'a\nb');
  assert.ok(g.joinClipped(['x'.repeat(5000)], 100).length <= 100);
});

test('modLabel mentions ids, passes tags', () => {
  assert.equal(g.modLabel('123456789012345678'), '<@123456789012345678>');
  assert.equal(g.modLabel('someone'), 'someone');
  assert.equal(g.modLabel(null), 'unknown');
});

test('reasonError', () => {
  assert.equal(g.reasonError('x'.repeat(512)), null);
  assert.ok(g.reasonError('x'.repeat(513)));
});

const role = (o) => ({ id: 'r', position: 3, managed: false, editable: true, ...o });
const inv = (pos, id = 'u') => ({ id, roles: { highest: { position: pos } } });

test('roleProblem', () => {
  const guild = { id: 'g', ownerId: 'o' };
  assert.equal(g.roleProblem(guild, inv(5), role()), null);
  assert.ok(g.roleProblem(guild, inv(3), role()));
  assert.ok(g.roleProblem(guild, inv(5), role({ managed: true })));
  assert.ok(g.roleProblem(guild, inv(5), role({ id: 'g' })));
  assert.ok(g.roleProblem(guild, inv(5), role({ editable: false })));
  assert.equal(g.roleProblem(guild, inv(1, 'o'), role()), null);
});

test('memberProblem uses >= and owner', () => {
  const guild = { id: 'g', ownerId: 'o' };
  const t = (pos, id = 't') => ({ ...inv(pos, id), manageable: true });
  assert.ok(g.memberProblem(guild, inv(5), t(5)));
  assert.equal(g.memberProblem(guild, inv(5), t(4)), null);
  assert.ok(g.memberProblem(guild, inv(5), t(1, 'o')));
  assert.ok(g.memberProblem(guild, inv(5), { ...t(1), manageable: false }));
});
