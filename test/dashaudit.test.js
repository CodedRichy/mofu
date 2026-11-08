// Dashboard audit log: storage (record/list/count/purge/truncation) and the API routes.
// Storage tests run on an in-memory database; the shared-db test uses a unique guild id and cleans up.
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { create } = require('../src/database/dashaudit');

const DAY = 86400000;
const rec = (guildId, n, extra = {}) => ({ guildId, userId: 'u1', username: 'alice', action: 'config.update', detail: `n${n}`, ...extra });

test('record/list/count: newest first, paged', () => {
  const a = create(new Database(':memory:'));
  for (let i = 1; i <= 7; i++) a.record(rec('g1', i), 1000 + i);
  a.record(rec('g2', 99), 2000);
  assert.equal(a.count('g1'), 7);
  assert.equal(a.count('g2'), 1);
  assert.equal(a.count('nobody'), 0);
  const page1 = a.list('g1', { limit: 3, offset: 0 });
  assert.deepEqual(page1.map((r) => r.detail), ['n7', 'n6', 'n5']);
  const page3 = a.list('g1', { limit: 3, offset: 6 });
  assert.deepEqual(page3.map((r) => r.detail), ['n1']);
  assert.deepEqual(a.list('g1', { limit: 3, offset: 50 }), []);
  assert.deepEqual(Object.keys(page1[0]).sort(), ['action', 'created_at', 'detail', 'id', 'user_id', 'username']);
});

test('list clamps limit and offset', () => {
  const a = create(new Database(':memory:'));
  for (let i = 0; i < 60; i++) a.record(rec('g', i), 1000 + i);
  assert.equal(a.list('g', { limit: 9999 }).length, 50);
  assert.equal(a.list('g', { limit: -5 }).length, 1);
  assert.equal(a.list('g', { limit: 'x', offset: -3 }).length, 25);
});

test('detail is truncated to 200 chars, single line', () => {
  const a = create(new Database(':memory:'));
  a.record(rec('g', 0, { detail: 'k'.repeat(500) }));
  a.record(rec('g', 0, { detail: 'a\nb\r\nc' }));
  const rows = a.list('g');
  assert.equal(rows[1].detail.length, 200);
  assert.ok(rows[1].detail.endsWith('...'));
  assert.equal(rows[0].detail, 'a b c');
});

test('record refuses rows with no guild, user or action', () => {
  const a = create(new Database(':memory:'));
  assert.equal(a.record({ guildId: 'g', action: 'x' }), false);
  assert.equal(a.record({ guildId: 'g', userId: 'u' }), false);
  assert.equal(a.count('g'), 0);
});

test('purge drops rows older than 90 days, keeps the rest', () => {
  const a = create(new Database(':memory:'));
  const now = Date.now();
  a.record(rec('g', 1), now - 91 * DAY);
  a.record(rec('g', 2), now - 89 * DAY);
  // the first record above may already have purged itself; either way only the recent one survives
  assert.equal(a.purge(now) >= 0, true);
  assert.deepEqual(a.list('g').map((r) => r.detail), ['n2']);
});

test('record purges old rows opportunistically', () => {
  const a = create(new Database(':memory:'));
  const now = Date.now();
  const db2 = a; // same handle; insert an old row then a fresh one an hour later
  db2.record(rec('g', 1), now - 100 * DAY);
  db2.record(rec('g', 2), now);
  assert.deepEqual(a.list('g').map((r) => r.detail), ['n2']);
});

test('retention covers the table (it has a guild_id column)', () => {
  const guildTables = require('../src/database/retention').guildTables;
  require('../src/database/dashaudit').count('dashaudit-retention-check'); // ensures the table exists on the shared db
  assert.ok(guildTables().includes('dashboard_audit'));
});

test('shared db: purgeGuild removes a guild audit rows', () => {
  const shared = require('../src/database/dashaudit');
  const { purgeGuild } = require('../src/database/retention');
  const G = `dashaudit-test-${Date.now()}`;
  try {
    shared.record({ guildId: G, userId: 'u', username: 'x', action: 'config.update', detail: 'prefix' });
    assert.equal(shared.count(G), 1);
    purgeGuild(G);
    assert.equal(shared.count(G), 0);
  } finally {
    require('../src/database/store').db.prepare('DELETE FROM dashboard_audit WHERE guild_id = ?').run(G);
  }
});

// ---- API: stubbed Discord, injected in-memory audit, no live db ----
test('api: mutations are recorded; GET /audit is gated and clamped', async () => {
  const realFetch = global.fetch;
  const GUILD = '333333333333333333';
  const OTHER = '444444444444444444';
  const perms = { tokA: [{ id: GUILD, permissions: '32' }], tokB: [{ id: GUILD, permissions: '1024' }] };
  const audit = create(new Database(':memory:'));
  const store = {
    db: {}, getConfig: () => null, setConfig() {},
    addCustomCommand() {}, removeCustomCommand: () => true,
    getBalance: () => ({ wallet: 0, bank: 0, total: 0 }), getBankCapacity: () => 100, addWallet() {}, addBank() {},
  };
  const guild = { name: 'G', memberCount: 1, channels: { cache: { size: 1 } }, roles: { cache: { size: 1 } }, iconURL: () => null };
  const client = { isReady: () => true, guilds: { cache: new Map([[GUILD, guild]]) }, commands: new Map(), users: { cache: new Map() } };
  global.fetch = async (url, opts) => {
    const tok = (opts?.headers?.Authorization || '').slice(7);
    if (!perms[tok]) return { ok: false, json: async () => ({}) };
    if (String(url).endsWith('/oauth2/@me')) return { ok: true, json: async () => ({ application: { id: require('../src/config').discord.clientId }, expires: new Date(Date.now() + 3600000).toISOString() }) };
    if (String(url).endsWith('/users/@me')) return { ok: true, json: async () => ({ id: `u-${tok}`, username: `name-${tok}` }) };
    return { ok: true, json: async () => perms[tok] };
  };
  require('../src/config').discord.clientId = require('../src/config').discord.clientId || 'test-app-id';
  const { createApp } = require('../src/dashboard/server');
  const app = createApp(client, { store, audit, ai: {}, xpDb: { setLevel: () => ({}), setXp: () => ({}) } });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, tok, body) => {
    const res = await realFetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    const p = `/api/guilds/${GUILD}`;
    assert.equal((await call('GET', `${p}/audit`, null)).status, 401);
    assert.equal((await call('GET', `${p}/audit`, 'tokB')).status, 403);
    // rejected or invalid writes leave no trail
    assert.equal((await call('PATCH', `${p}/config`, 'tokA', { evil: 1 })).status, 400);
    assert.equal((await call('PATCH', `${p}/config`, 'tokB', { prefix: '!' })).status, 403);
    assert.equal(audit.count(GUILD), 0);

    assert.equal((await call('PATCH', `${p}/config`, 'tokA', { prefix: 'SECRT', antispam: true })).status, 200);
    assert.equal((await call('PATCH', `${p}/automod-config`, 'tokA', { antispam_threshold: 5 })).status, 200);
    assert.equal((await call('PATCH', `${p}/leveling-config`, 'tokA', { enabled: false })).status, 200);
    assert.equal((await call('POST', `${p}/custom-commands`, 'tokA', { name: 'hello', response: 'private reply text' })).status, 200);
    assert.equal((await call('DELETE', `${p}/custom-commands/hello`, 'tokA')).status, 200);
    assert.equal((await call('PATCH', `${p}/economy/${OTHER}`, 'tokA', { wallet: 5 })).status, 200);
    assert.equal((await call('PATCH', `${p}/xp/${OTHER}`, 'tokA', { level: 3 })).status, 200);

    const all = await call('GET', `${p}/audit`, 'tokA');
    assert.equal(all.status, 200);
    assert.equal(all.body.total, 7);
    assert.deepEqual(all.body.records.map((r) => r.action), [
      'xp.set', 'economy.set', 'custom_command.delete', 'custom_command.create', 'leveling.update', 'automod.update', 'config.update',
    ]);
    const first = all.body.records.at(-1);
    assert.equal(first.user_id, 'u-tokA');
    assert.equal(first.username, 'name-tokA');
    assert.equal(first.detail, 'prefix, antispam=true'); // key names, booleans only; no values
    const dump = JSON.stringify(all.body);
    assert.ok(!dump.includes('SECRT'));
    assert.ok(!dump.includes('private reply text'));

    // paging and clamping
    const page = await call('GET', `${p}/audit?limit=2&offset=2`, 'tokA');
    assert.equal(page.body.records.length, 2);
    assert.equal(page.body.total, 7);
    assert.equal((await call('GET', `${p}/audit?limit=9999`, 'tokA')).body.records.length, 7);
    assert.equal((await call('GET', `${p}/audit?limit=abc&offset=-4`, 'tokA')).body.records.length, 7);
  } finally {
    global.fetch = realFetch;
    server.close();
  }
});
