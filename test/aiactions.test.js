const test = require('node:test');
const assert = require('node:assert');
const audit = require('../src/database/aiActions');
const retention = require('../src/database/retention');
const { db } = require('../src/database/store');

const G = 'test-guild-aiactions';
test.after(() => db.prepare('DELETE FROM ai_actions WHERE guild_id = ?').run(G));

test('records a proposal and resolves it exactly once', () => {
  const id = audit.record({ guildId: G, invokerId: 'u1', targetId: 'u2', kind: 'mute', reason: 'spam', durationMs: 600000, prompt: 'sonder mute u2' });
  assert.ok(id);
  assert.strictEqual(audit.recent(G)[0].status, 'proposed');
  assert.strictEqual(audit.resolve(id, 'executed'), true);
  // a late expiry timer must not overwrite the real outcome
  assert.strictEqual(audit.resolve(id, 'expired'), false);
  assert.strictEqual(audit.recent(G)[0].status, 'executed');
});

test('rejects unknown statuses and missing ids without throwing', () => {
  assert.strictEqual(audit.resolve(null, 'executed'), false);
  assert.strictEqual(audit.resolve(999999999, 'bogus'), false);
  assert.strictEqual(audit.resolve(999999999, 'proposed'), false);
});

test('recent filters by status and is capped', () => {
  for (let i = 0; i < 30; i++) {
    const id = audit.record({ guildId: G, invokerId: 'u1', targetId: 'u2', kind: 'warn' });
    if (i % 2) audit.resolve(id, 'cancelled');
  }
  assert.strictEqual(audit.recent(G, 1000).length, 25);
  assert.ok(audit.recent(G, 25, 'cancelled').every((r) => r.status === 'cancelled'));
});

test('data retention purge covers the audit table', () => {
  assert.ok(retention.guildTables().includes('ai_actions'));
  audit.record({ guildId: G, invokerId: 'u1', targetId: 'u2', kind: 'kick' });
  retention.purgeGuild(G);
  assert.strictEqual(audit.recent(G).length, 0);
});

test('a database error never throws out of record()', () => {
  assert.doesNotThrow(() => audit.record({ guildId: null, invokerId: null, targetId: null, kind: null }));
});
