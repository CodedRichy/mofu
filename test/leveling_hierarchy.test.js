// Dashboard PATCH leveling-config: a NEW level-reward role must be below the person saving it (same rule as /levelrole).
const test = require('node:test');
const assert = require('node:assert');

test('api: PATCH leveling-config enforces role hierarchy for new level rewards only', async () => {
  const realFetch = global.fetch;
  const cfg = require('../src/config');
  cfg.discord.clientId = cfg.discord.clientId || 'test-app-id';
  const GUILD = '555555555555555571';
  const HIGH = '555555555555555581'; // above the requester
  const LOW = '555555555555555582';  // below the requester
  const OLD = '555555555555555583';  // already stored, above the requester
  const BOTHIGH = '555555555555555584'; // below the requester but not editable by the bot
  const role = (id, position, editable = true) => ({ id, position, editable, managed: false });
  const roles = new Map([[HIGH, role(HIGH, 10)], [LOW, role(LOW, 2)], [OLD, role(OLD, 10)], [BOTHIGH, role(BOTHIGH, 3, false)]]);
  const member = { id: 'u-tokA', roles: { highest: { position: 5 } } };
  const guild = {
    id: GUILD, name: 'G', ownerId: 'someone-else', memberCount: 1,
    channels: { cache: { size: 1 } }, roles: { cache: roles }, iconURL: () => null,
    members: { cache: new Map([[member.id, member]]), fetch: async () => member },
  };
  const client = { isReady: () => true, guilds: { cache: new Map([[GUILD, guild]]) }, commands: new Map(), users: { cache: new Map() } };
  const kv = new Map([[`${GUILD}:level_roles`, [{ level: 5, role: OLD }]]]);
  const store = {
    db: {},
    getConfig: (g, k) => (kv.has(`${g}:${k}`) ? kv.get(`${g}:${k}`) : null),
    setConfig: (g, k, v) => { kv.set(`${g}:${k}`, v); },
  };
  global.fetch = async (url, opts) => {
    const tok = (opts?.headers?.Authorization || '').slice(7);
    if (tok !== 'tokA') return { ok: false, json: async () => ({}) };
    if (String(url).endsWith('/oauth2/@me')) return { ok: true, json: async () => ({ application: { id: cfg.discord.clientId }, expires: new Date(Date.now() + 3600000).toISOString() }) };
    if (String(url).endsWith('/users/@me')) return { ok: true, json: async () => ({ id: 'u-tokA', username: 'name' }) };
    return { ok: true, json: async () => [{ id: GUILD, permissions: '32' }] };
  };
  const { createApp } = require('../src/dashboard/server');
  const app = createApp(client, { store, audit: null, insights: null, ai: {} });
  const server = app.listen(0);
  const url = `http://127.0.0.1:${server.address().port}/api/guilds/${GUILD}/leveling-config`;
  const patch = async (level_roles) => {
    const res = await realFetch(url, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer tokA', 'Content-Type': 'application/json' },
      body: JSON.stringify({ level_roles }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    const high = await patch([{ level: 5, role: OLD }, { level: 10, role: HIGH }]);
    assert.equal(high.status, 403);
    assert.match(high.body.error, /above your highest role/);
    assert.deepEqual(kv.get(`${GUILD}:level_roles`), [{ level: 5, role: OLD }], 'nothing saved on rejection');

    const unassignable = await patch([{ level: 5, role: OLD }, { level: 10, role: BOTHIGH }]);
    assert.equal(unassignable.status, 403);

    const ok = await patch([{ level: 5, role: OLD }, { level: 10, role: LOW }]);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(kv.get(`${GUILD}:level_roles`).length, 2, 'existing reward kept without re-check');
  } finally {
    server.close();
    global.fetch = realFetch;
  }
});
