// Insights: aggregate counters, query shape (null = not counted, never fake zeros), retention, and the API route.
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { create } = require('../src/database/insights');
const infractions = require('../src/database/infractions');

const DAY = 86400000;
const NOW = Date.now();
const mk = () => { const db = new Database(':memory:'); return { db, ins: create(db), inf: infractions.create(db) }; };

test('counters buffer in memory and flush as one number per guild per day', () => {
  const { db, ins } = mk();
  for (let i = 0; i < 500; i++) ins.countMessage('g1', NOW);
  ins.countJoin('g1', NOW);
  ins.countLeave('g1', NOW);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guild_daily_stats').get().n, 0, 'nothing written per message');
  ins.flush();
  const rows = db.prepare('SELECT * FROM guild_daily_stats').all();
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].messages, rows[0].joins, rows[0].leaves], [500, 1, 1]);
});

test('no user, channel or text columns are stored', () => {
  const { db } = mk();
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name).sort();
  assert.deepEqual(cols('guild_daily_stats'), ['day', 'guild_id', 'joins', 'leaves', 'messages']);
  assert.deepEqual(cols('guild_daily_commands'), ['command', 'day', 'guild_id', 'uses']);
});

test('query: a server with no counters reports unavailable, not zeros', () => {
  const { ins } = mk();
  const q = ins.query('empty', { days: 7, now: NOW });
  assert.equal(q.counters.available, false);
  assert.equal(q.counters.since, null);
  assert.equal(q.series.messages.length, 7);
  assert.ok(q.series.messages.every((p) => p.count === null));
  assert.equal(q.totals.messages, null);
  assert.equal(q.totals.commands, null);
  assert.deepEqual(q.topCommands, []);
  assert.equal(q.busiest, null);
  assert.ok(q.notes.some((n) => /not started/.test(n)));
});

test('query: days before the first counted day are null, later empty days are real zeros', () => {
  const { ins } = mk();
  ins.countMessage('g', NOW - 4 * DAY);
  ins.countMessage('g', NOW - 4 * DAY);
  ins.countMessage('g', NOW - 1 * DAY);
  ins.countJoin('g', NOW - 1 * DAY);
  const q = ins.query('g', { days: 7, now: NOW });
  const m = q.series.messages;
  assert.deepEqual(m.map((p) => p.count), [null, null, 2, 0, 0, 1, 0]);
  assert.equal(q.counters.since, m[2].date);
  assert.equal(q.totals.messages, 3);
  assert.equal(q.totals.joins, 1);
  assert.equal(q.totals.leaves, 0);
  assert.equal(q.totals.netMembers, 1);
  assert.equal(q.busiest.count, 2);
  assert.equal(q.previous.messages, null, 'counting began inside the range, so no comparison');
  assert.ok(q.notes.some((n) => /start from/.test(n)));
});

test('query: previous period delta only when counting covers it', () => {
  const { ins } = mk();
  ins.countMessage("g", NOW - 13 * DAY);
  for (let i = 0; i < 4; i++) ins.countMessage('g', NOW - 10 * DAY);
  for (let i = 0; i < 6; i++) ins.countMessage('g', NOW - 2 * DAY);
  const q = ins.query('g', { days: 7, now: NOW });
  assert.equal(q.totals.messages, 6);
  assert.equal(q.previous.messages, 5);
  const q30 = ins.query('g', { days: 30, now: NOW });
  assert.equal(q30.range.days, 30);
  assert.equal(q30.series.messages.length, 30);
  assert.equal(q30.previous.messages, null);
  assert.equal(ins.query('g', { days: 99, now: NOW }).range.days, 7);
});

test('query: commands are summed per name, ranked, and have no user ids', () => {
  const { ins } = mk();
  ins.countMessage('g', NOW);
  for (let i = 0; i < 3; i++) ins.countCommand('g', 'ban', NOW);
  ins.countCommand('g', 'help', NOW - DAY);
  ins.countCommand('g', 'help', NOW);
  ins.countCommand('other', 'ban', NOW);
  ins.countCommand('g', 'old', NOW - 20 * DAY);
  const q = ins.query('g', { days: 7, now: NOW });
  assert.deepEqual(q.topCommands, [{ name: 'ban', count: 3 }, { name: 'help', count: 2 }]);
  assert.equal(q.totals.commands, 5);
});

test('query: mod actions come from cases, by day and type, voided cases left out, other guilds ignored', () => {
  const { ins, inf } = mk();
  inf.openCase({ guildId: 'g', action: 'warn', now: NOW - DAY });
  inf.openCase({ guildId: 'g', action: 'Warn', now: NOW - DAY });
  inf.openCase({ guildId: 'g', action: 'ban', now: NOW });
  const v = inf.openCase({ guildId: 'g', action: 'kick', now: NOW });
  inf.voidCase('g', v);
  inf.openCase({ guildId: 'g', action: 'mute', now: NOW - 10 * DAY });
  inf.openCase({ guildId: 'other', action: 'ban', now: NOW });
  const q = ins.query('g', { days: 7, now: NOW });
  assert.equal(q.totals.modActions, 3);
  assert.equal(q.previous.modActions, 1);
  assert.deepEqual(q.modByType, [{ type: 'warn', count: 2 }, { type: 'ban', count: 1 }]);
  assert.equal(q.series.modActions.length, 7);
  assert.equal(q.series.modActions[6].count, 1);
  assert.equal(q.series.modActions[5].count, 2);
  assert.equal(q.counters.available, false, 'cases exist but message counters never started');
});

test('prune drops counter rows older than 90 days', () => {
  const { db, ins } = mk();
  ins.countMessage('g', NOW - 100 * DAY);
  ins.countCommand('g', 'x', NOW - 100 * DAY);
  ins.countMessage('g', NOW);
  ins.flush();
  ins.prune(NOW);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guild_daily_stats').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guild_daily_commands').get().n, 0);
});

test('activeChatters: null without xp rows, else distinct members who earned xp in the window', () => {
  const { db, ins } = mk();
  db.exec('CREATE TABLE xp (guild_id TEXT, user_id TEXT, last_message INTEGER)');
  assert.equal(ins.activeChatters('g', 7, NOW), null);
  const add = db.prepare('INSERT INTO xp VALUES (?, ?, ?)');
  add.run('g', 'a', NOW - DAY); add.run('g', 'b', NOW - 30 * DAY); add.run('g', 'c', NOW - 2 * DAY);
  assert.equal(ins.activeChatters('g', 7, NOW), 2);
  assert.equal(ins.activeChatters('g', 30, NOW - DAY * 0), 3);
});

test('retention purge covers both tables (shared db, unique guild id, cleaned up)', () => {
  const store = require('../src/database/store');
  const shared = require('../src/database/insights');
  const { purgeGuild, guildTables } = require('../src/database/retention');
  const G = `insights-test-${Date.now()}`;
  try {
    shared.countMessage(G); shared.countCommand(G, 'ping'); shared.flush();
    assert.ok(guildTables().includes('guild_daily_stats'));
    assert.ok(guildTables().includes('guild_daily_commands'));
    purgeGuild(G);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM guild_daily_stats WHERE guild_id = ?').get(G).n, 0);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM guild_daily_commands WHERE guild_id = ?').get(G).n, 0);
  } finally {
    store.db.prepare('DELETE FROM guild_daily_stats WHERE guild_id = ?').run(G);
    store.db.prepare('DELETE FROM guild_daily_commands WHERE guild_id = ?').run(G);
  }
});

test('api: GET /insights is gated by Manage Server and returns aggregates only', async () => {
  const realFetch = global.fetch;
  const GUILD = '555555555555555551';
  const perms = { tokA: [{ id: GUILD, permissions: '32' }], tokB: [{ id: GUILD, permissions: '1024' }] };
  const { ins } = mk();
  ins.countMessage(GUILD); ins.countCommand(GUILD, 'ping');
  const store = { db: {}, getConfig: () => null, setConfig() {} };
  const guild = { name: 'G', memberCount: 42, channels: { cache: { size: 1 } }, roles: { cache: { size: 1 } }, iconURL: () => null };
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
  const app = createApp(client, { store, audit: null, insights: ins, ai: {} });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (path, tok) => {
    const res = await realFetch(base + path, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    const p = `/api/guilds/${GUILD}/insights`;
    assert.equal((await get(p, null)).status, 401);
    assert.equal((await get(p, 'tokB')).status, 403);
    assert.equal((await get('/api/guilds/999999999999999999/insights', 'tokA')).status, 404);
    const r = await get(`${p}?days=30`, 'tokA');
    assert.equal(r.status, 200);
    assert.equal(r.body.range.days, 30);
    assert.equal(r.body.series.messages.length, 30);
    assert.equal(r.body.totals.messages, 1);
    assert.deepEqual(r.body.topCommands, [{ name: 'ping', count: 1 }]);
    assert.equal(r.body.members.total, 42);
    assert.equal(r.body.members.activeChatters, null);
    assert.ok(Array.isArray(r.body.notes));
    assert.equal((await get(`${p}?days=abc`, 'tokA')).body.range.days, 7);
    assert.ok(!JSON.stringify(r.body).match(/user|channel|content/i), 'no user, channel or text fields');
  } finally {
    server.close();
    global.fetch = realFetch;
  }
});

test('api: GET /api/insights/overview aggregates only managed servers the bot is in', async () => {
  const realFetch = global.fetch;
  const A = '555555555555555561'; const B = '555555555555555562'; const NOMANAGE = '555555555555555563'; const NOBOT = '555555555555555564';
  const perms = { tokA: [A, B, NOMANAGE, NOBOT].map((id) => ({ id, name: `n${id.slice(-2)}`, icon: null, permissions: id === NOMANAGE ? '1024' : '32' })) };
  const { ins } = mk();
  ins.countMessage(A); ins.countMessage(A); ins.countJoin(A);
  ins.countMessage(B);
  ins.countMessage(NOMANAGE); ins.countMessage(NOMANAGE); ins.countMessage(NOMANAGE);
  const mkGuild = (n) => ({ name: 'x', memberCount: n, channels: { cache: { size: 1 } }, roles: { cache: { size: 1 } }, iconURL: () => null });
  const client = { isReady: () => true, guilds: { cache: new Map([[A, mkGuild(10)], [B, mkGuild(5)], [NOMANAGE, mkGuild(99)]]) }, commands: new Map(), users: { cache: new Map() } };
  global.fetch = async (url, opts) => {
    const tok = (opts?.headers?.Authorization || '').slice(7);
    if (!perms[tok]) return { ok: false, json: async () => ({}) };
    if (String(url).endsWith('/oauth2/@me')) return { ok: true, json: async () => ({ application: { id: require('../src/config').discord.clientId }, expires: new Date(Date.now() + 3600000).toISOString() }) };
    if (String(url).endsWith('/users/@me')) return { ok: true, json: async () => ({ id: `u-${tok}`, username: `name-${tok}` }) };
    return { ok: true, json: async () => perms[tok] };
  };
  require('../src/config').discord.clientId = require('../src/config').discord.clientId || 'test-app-id';
  const { createApp } = require('../src/dashboard/server');
  const app = createApp(client, { store: { db: {}, getConfig: () => null, setConfig() {} }, audit: null, insights: ins, ai: {} });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await realFetch(`${base}/api/insights/overview`)).status, 401);
    const res = await realFetch(`${base}/api/insights/overview?days=30`, { headers: { Authorization: 'Bearer tokA' } });
    assert.equal(res.status, 200);
    const b = await res.json();
    assert.equal(b.range.days, 30);
    assert.deepEqual(b.perServer.map((s) => s.guildId).sort(), [A, B]);
    assert.equal(b.totals.members, 15);
    assert.equal(b.totals.messages, 3, 'the server without Manage Server is not counted');
    assert.equal(b.totals.joins, 1);
    assert.equal(b.series.messages.length, 30);
    assert.equal(b.series.messages[29].count, 3);
    assert.equal(b.previous.messages, null);
    assert.equal(b.totals.activeChatters, null);
    assert.equal(b.perServer[0].series.length, 30);
    assert.ok(!JSON.stringify(b).includes(NOMANAGE) && !JSON.stringify(b).includes(NOBOT));
  } finally {
    server.close();
    global.fetch = realFetch;
  }
});
