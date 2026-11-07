const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { create } = require('../src/database/infractions');
const { expireDue, backoffMs, MAX_ATTEMPTS } = require('../src/utils/tempban');

const quiet = { warn() {}, info() {} };

function setup(unbanImpl) {
  const inf = create(new Database(':memory:'));
  const sent = [];
  const unbans = [];
  const guild = { id: 'g', members: { unban: async (id, reason) => { unbans.push([id, reason]); if (unbanImpl) await unbanImpl(id); } } };
  const client = {
    user: { id: 'bot', tag: 'Sonder#0001' },
    guilds: { cache: new Map([['g', guild]]) },
    users: { fetch: async (id) => ({ id, tag: `${id}#1`, displayAvatarURL: () => null }) },
  };
  const modlog = { send: async (g, e) => { sent.push(e); return 1; } };
  return { inf, sent, unbans, client, deps: { infractions: inf, modlog, log: quiet } };
}

test('due tempbans are lifted with an unban case; future and foreign ones are left alone', async () => {
  const s = setup();
  s.inf.addTempban({ guildId: 'g', userId: 'u1', expiresAt: 1000, caseId: 4 });
  s.inf.addTempban({ guildId: 'g', userId: 'u2', expiresAt: 99999 });
  s.inf.addTempban({ guildId: 'other-shard', userId: 'u3', expiresAt: 1000 });
  const out = await expireDue(s.client, { ...s.deps, now: 5000 });
  assert.deepStrictEqual(out, [{ userId: 'u1', outcome: 'unbanned' }]);
  assert.deepStrictEqual(s.unbans, [['u1', 'Tempban expired (case #4)']]);
  assert.strictEqual(s.sent[0].action, 'unban');
  assert.strictEqual(s.sent[0].moderator.id, 'bot');
  assert.strictEqual(s.inf.getTempban('g', 'u1'), null);
  assert.ok(s.inf.getTempban('g', 'u2'));
  assert.ok(s.inf.getTempban('other-shard', 'u3'));
});

test('a ban removed by hand (10026) just clears the row, no case', async () => {
  const s = setup(async () => { const e = new Error('Unknown Ban'); e.code = 10026; throw e; });
  s.inf.addTempban({ guildId: 'g', userId: 'u1', expiresAt: 1000 });
  const out = await expireDue(s.client, { ...s.deps, now: 5000 });
  assert.strictEqual(out[0].outcome, 'already-unbanned');
  assert.strictEqual(s.sent.length, 0);
  assert.strictEqual(s.inf.getTempban('g', 'u1'), null);
});

test('failures back off, then give up after MAX_ATTEMPTS', async () => {
  const s = setup(async () => { const e = new Error('Missing Permissions'); e.code = 50013; throw e; });
  s.inf.addTempban({ guildId: 'g', userId: 'u1', expiresAt: 1000 });
  let now = 5000;
  let out = await expireDue(s.client, { ...s.deps, now });
  assert.strictEqual(out[0].outcome, 'retry');
  assert.strictEqual(s.inf.getTempban('g', 'u1').next_try_at, now + backoffMs(1));
  assert.deepStrictEqual(await expireDue(s.client, { ...s.deps, now: now + 1 }), []); // not due again yet
  for (let i = 2; i <= MAX_ATTEMPTS; i++) {
    now = s.inf.getTempban('g', 'u1').next_try_at;
    out = await expireDue(s.client, { ...s.deps, now });
  }
  assert.strictEqual(out[0].outcome, 'gave-up');
  assert.strictEqual(s.inf.getTempban('g', 'u1'), null);
});

test('backoff grows and is capped at 6h', () => {
  assert.strictEqual(backoffMs(1), 60000);
  assert.strictEqual(backoffMs(2), 120000);
  assert.strictEqual(backoffMs(50), 6 * 3600000);
});
