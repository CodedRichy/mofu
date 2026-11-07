const test = require('node:test');
const assert = require('node:assert');
const OAuth = require('../src/dashboard/oauthState');

const SECRET = 'test-secret-not-real';

function mgr(clock = { t: 1_000_000 }) {
  return { clock, m: OAuth.createStateManager({ secret: SECRET, now: () => clock.t }) };
}

test('issued state verifies once, then is rejected as a replay', () => {
  const { m } = mgr();
  const { state, cookieValue } = m.issue();
  assert.match(state, /^[A-Za-z0-9_-]{32}$/);
  assert.deepEqual(m.verify(cookieValue, state), { ok: true });
  assert.equal(m.verify(cookieValue, state).reason, 'replayed');
});

test('mismatched, missing, malformed and tampered states are rejected', () => {
  const { m } = mgr();
  const a = m.issue();
  const b = m.issue();
  assert.equal(m.verify(a.cookieValue, b.state).reason, 'mismatch');
  assert.equal(m.verify(undefined, a.state).reason, 'no_cookie');
  assert.equal(m.verify('garbage', a.state).reason, 'no_cookie');
  assert.equal(m.verify(a.cookieValue, '').reason, 'bad_state');
  assert.equal(m.verify(a.cookieValue, 'x'.repeat(200)).reason, 'bad_state');
  assert.equal(m.verify(a.cookieValue, { $ne: 1 }).reason, 'bad_state');
  // swap the state inside the cookie but keep the old signature
  const [, exp, mac] = a.cookieValue.split('.');
  assert.equal(m.verify(`${b.state}.${exp}.${mac}`, b.state).reason, 'bad_signature');
  // extend the expiry without re-signing
  const [st, , mac2] = a.cookieValue.split('.');
  assert.equal(m.verify(`${st}.${Number(exp) + 9e9}.${mac2}`, st).reason, 'bad_signature');
  // a different secret cannot mint cookies
  const other = OAuth.createStateManager({ secret: 'other', now: () => 1_000_000 }).issue();
  assert.equal(m.verify(other.cookieValue, other.state).reason, 'bad_signature');
  // the untouched one still works
  assert.equal(m.verify(a.cookieValue, a.state).ok, true);
});

test('state expires after 10 minutes', () => {
  const { m, clock } = mgr();
  const { state, cookieValue } = m.issue();
  clock.t += OAuth.TTL_MS + 1;
  assert.equal(m.verify(cookieValue, state).reason, 'expired');
});

test('cookie helpers', () => {
  assert.deepEqual(OAuth.parseCookies('a=1; sonder_oauth=x.y.z; b=2'), { a: '1', sonder_oauth: 'x.y.z', b: '2' });
  assert.deepEqual(OAuth.parseCookies(undefined), {});
  const set = OAuth.setCookieHeader('v', { secure: true });
  for (const part of ['HttpOnly', 'SameSite=Lax', 'Secure', 'Path=/api/auth', 'Max-Age=600']) assert.ok(set.includes(part), part);
  assert.ok(!OAuth.setCookieHeader('v', { secure: false }).includes('Secure'));
  assert.ok(OAuth.clearCookieHeader().includes('Max-Age=0'));
  assert.equal(OAuth.safeEqual('abc', 'abc'), true);
  assert.equal(OAuth.safeEqual('abc', 'abcd'), false);
  assert.throws(() => OAuth.createStateManager({}));
});

// --- server wiring (no live DB, no Discord) ---------------------------------------------------------------

function fakeClient(ready = true) {
  return {
    isReady: () => ready,
    ws: { ping: 42 },
    guilds: { cache: new Map() },
    commands: new Map(),
    users: { cache: new Map() },
  };
}
const okDb = { prepare: () => ({ get: () => ({ ok: 1 }), all: () => [], run: () => ({ changes: 0 }) }) };
const badDb = { prepare: () => { throw new Error('disk gone'); } };

async function withServer(client, deps, fn) {
  const { createApp } = require('../src/dashboard/server');
  const app = createApp(client, { store: {}, db: okDb, oauthSecret: SECRET, ...deps });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}

test('login sets an httpOnly state cookie and redirects to Discord with the same state', async () => {
  const config = require('../src/config');
  const saved = config.discord.clientId;
  config.discord.clientId = '123456789012345678';
  try {
    await withServer(fakeClient(), {}, async (base) => {
      const r = await fetch(`${base}/api/auth/login`, { redirect: 'manual' });
      assert.equal(r.status, 302);
      const loc = new URL(r.headers.get('location'));
      assert.equal(loc.hostname, 'discord.com');
      const state = loc.searchParams.get('state');
      const cookie = r.headers.get('set-cookie');
      assert.ok(cookie.includes('HttpOnly') && cookie.includes('SameSite=Lax'));
      assert.ok(cookie.startsWith(`sonder_oauth=${state}.`));
    });
  } finally { config.discord.clientId = saved; }
});

test('callback refuses to exchange a code without a valid state and never calls Discord', async () => {
  const realFetch = global.fetch;
  let discordCalls = 0;
  await withServer(fakeClient(), {}, async (base) => {
    global.fetch = (url, init) => {
      if (String(url).startsWith('https://discord.com')) { discordCalls++; return Promise.resolve(new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 })); }
      return realFetch(url, init);
    };
    try {
      const post = (body, cookie) => realFetch(`${base}/api/auth/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: JSON.stringify(body),
      });
      let r = await post({ code: 'abc', state: 'A'.repeat(32) });
      assert.equal(r.status, 400);
      assert.equal(discordCalls, 0);

      // a real login round trip: cookie from /login, state from the redirect
      const OAuthMod = require('../src/dashboard/oauthState');
      const config = require('../src/config');
      const saved = config.discord.clientId;
      config.discord.clientId = '123456789012345678';
      const login = await realFetch(`${base}/api/auth/login`, { redirect: 'manual' });
      config.discord.clientId = saved;
      const state = new URL(login.headers.get('location')).searchParams.get('state');
      const cookieVal = OAuthMod.parseCookies(login.headers.get('set-cookie').split(';')[0])[OAuthMod.COOKIE_NAME];
      const cookie = `${OAuthMod.COOKIE_NAME}=${cookieVal}`;

      r = await post({ code: 'abc', state: 'B'.repeat(32) }, cookie);
      assert.equal(r.status, 400, 'wrong state');
      r = await post({ code: 'abc', state }, cookie);
      assert.equal(r.status, 200);
      assert.equal((await r.json()).access_token, 'tok');
      assert.ok(r.headers.get('set-cookie').includes('Max-Age=0'), 'cookie cleared');
      assert.equal(discordCalls, 1);
      r = await post({ code: 'abc', state }, cookie);
      assert.equal(r.status, 400, 'replay');
      assert.equal(discordCalls, 1);
    } finally { global.fetch = realFetch; }
  });
});

test('healthz: 200 with gateway, ping, db and uptime when ready; 503 when not ready or db down; no secrets', async () => {
  await withServer(fakeClient(true), {}, async (base) => {
    const r = await fetch(`${base}/healthz`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.deepEqual(Object.keys(body).sort(), ['commands', 'db', 'discord', 'lastBackupAt', 'ok', 'providers', 'sharding', 'uptimeSeconds']);
    assert.equal(body.discord.ready, true);
    assert.equal(body.discord.wsPingMs, 42);
    assert.equal(body.db.ok, true);
    assert.equal(typeof body.uptimeSeconds, 'number');
    assert.ok(!/token|secret|key/i.test(JSON.stringify(body)));
  });
  await withServer(fakeClient(false), {}, async (base) => {
    const r = await fetch(`${base}/healthz`);
    assert.equal(r.status, 503);
    assert.equal((await r.json()).discord.ready, false);
  });
  await withServer(fakeClient(true), { db: badDb }, async (base) => {
    const r = await fetch(`${base}/healthz`);
    assert.equal(r.status, 503);
    assert.equal((await r.json()).db.ok, false);
  });
});
