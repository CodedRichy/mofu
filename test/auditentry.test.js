const test = require('node:test');
const assert = require('node:assert');
const { pickEntry } = require('../src/utils/auditEntry');

const NOW = 1_000_000;
const e = (target, executor, age) => ({ target: { id: target }, executor: { id: executor }, createdTimestamp: NOW - age });

test('picks the entry for this target, not just the newest one', () => {
  const entries = [e('victim2', 'bystander', 100), e('victim1', 'attacker', 800)];
  assert.strictEqual(pickEntry(entries, 'victim1', NOW).executor.id, 'attacker');
});

test('ignores stale entries', () => {
  assert.strictEqual(pickEntry([e('victim1', 'old-mod', 60_000)], 'victim1', NOW), null);
});

test('returns null when the entry has not been written yet', () => {
  assert.strictEqual(pickEntry([e('someone-else', 'x', 100)], 'victim1', NOW), null);
});

test('takes the most recent when the same target appears twice', () => {
  const entries = [e('t', 'first', 5000), e('t', 'second', 200)];
  assert.strictEqual(pickEntry(entries, 't', NOW).executor.id, 'second');
});

test('skips entries with no executor', () => {
  assert.strictEqual(pickEntry([{ target: { id: 't' }, executor: null, createdTimestamp: NOW }], 't', NOW), null);
});
