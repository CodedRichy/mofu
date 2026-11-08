// Second hardening pass: atomic economy moves, applyPlan ordering, blackjack timeout forfeit.
const test = require('node:test');
const assert = require('node:assert');
const store = require('../src/database/store');
const { applyPlan } = require('../src/handlers/rolepanel');

const U = Date.now();
const G1 = `h2-guild-a-${U}`;
const G2 = `h2-guild-b-${U}`;
test.after(() => {
  store.db.prepare('DELETE FROM economy WHERE guild_id IN (?, ?)').run(G1, G2);
});

test('transfer moves coins atomically and keeps its return values', () => {
  store.addWallet(G1, 'a', 100);
  assert.strictEqual(store.transfer(G1, 'a', 'b', 500), null); // not enough
  assert.deepStrictEqual(store.transfer(G1, 'a', 'b', 40), { from: 60, to: 40 });
  assert.strictEqual(store.getBalance(G1, 'a').wallet, 60);
  assert.strictEqual(store.getBalance(G1, 'b').wallet, 40);
});

test('transfer: a failing credit rolls the debit back', () => {
  store.addWallet(G2, 'a', 100);
  assert.throws(() => store.transfer(G2, 'a', null, 30)); // credit write violates NOT NULL
  assert.strictEqual(store.getBalance(G2, 'a').wallet, 100);
});

test('deposit and withdraw keep their results', () => {
  store.addWallet(G2, 'd', 200);
  assert.deepStrictEqual(store.deposit(G2, 'd', 50), { wallet: 150, bank: 50, deposited: 50 });
  assert.strictEqual(store.deposit(G2, 'd', 9999), null);
  assert.deepStrictEqual(store.withdraw(G2, 'd', 20), { wallet: 170, bank: 30 });
  assert.strictEqual(store.withdraw(G2, 'd', 999), null);
});

function fakeGuild(roles) {
  return { id: 'g', roles: { cache: new Map(roles.map((r) => [r.id, { editable: true, managed: false, permissions: 0n, ...r }])) } };
}

test('applyPlan adds first and skips removals when an add fails', async () => {
  const calls = [];
  const member = { roles: {
    add: async (id) => { calls.push(`add:${id}`); throw Object.assign(new Error('x'), { code: 50013 }); },
    remove: async (id) => { calls.push(`remove:${id}`); },
  } };
  const guild = fakeGuild([{ id: 'new', name: 'New' }, { id: 'old', name: 'Old' }]);
  const res = await applyPlan(guild, member, { add: ['new'], remove: ['old'], already: [], missing: [] }, []);
  assert.deepStrictEqual(calls, ['add:new']);
  assert.deepStrictEqual(res.removed, []);
  assert.ok(res.failed.length >= 2);
});

test('applyPlan removes after a successful add', async () => {
  const calls = [];
  const member = { roles: {
    add: async (id) => { calls.push(`add:${id}`); },
    remove: async (id) => { calls.push(`remove:${id}`); },
  } };
  const guild = fakeGuild([{ id: 'new', name: 'New' }, { id: 'old', name: 'Old' }]);
  const res = await applyPlan(guild, member, { add: ['new'], remove: ['old'], already: [], missing: [] }, []);
  assert.deepStrictEqual(calls, ['add:new', 'remove:old']);
  assert.deepStrictEqual(res.failed, []);
});

test('dashboard rejects a Discord token issued to another application', async () => {
  const config = require('../src/config');
  config.discord.clientId = config.discord.clientId || 'test-app-id';
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).endsWith('/oauth2/@me')) return { ok: true, json: async () => ({ application: { id: 'someone-elses-app' }, expires: new Date(Date.now() + 3600000).toISOString() }) };
    if (String(url).endsWith('/users/@me')) return { ok: true, json: async () => ({ id: 'u1' }) };
    return { ok: true, json: async () => ([]) };
  };
  const { createApp } = require('../src/dashboard/server');
  const app = createApp({ isReady: () => true, guilds: { cache: new Map() }, commands: new Map(), users: { cache: new Map() } }, { store: { db: {}, getConfig: () => null, setConfig() {} }, ai: {}, xpDb: {} });
  const server = app.listen(0);
  try {
    const res = await realFetch(`http://127.0.0.1:${server.address().port}/api/stats`, { headers: { Authorization: 'Bearer foreign-token' } });
    assert.strictEqual(res.status, 401);
  } finally {
    global.fetch = realFetch;
    server.close();
  }
});
