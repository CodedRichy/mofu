// Natural-language command router (src/ai/router.js). The model is always a stub: no network.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { Collection } = require('discord.js');

// Never open data/sonder.db: database modules are stubbed before anything loads them.
const dbDir = path.join(__dirname, '..', 'src', 'database');
const inert = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : inert), apply: () => undefined });
const overrides = {
  'store.js': { getConfig: () => null, setConfig: () => {} },
  'aiActions.js': { record: () => 1, resolve: () => true, recent: () => [] },
};
for (const f of fs.readdirSync(dbDir).filter((x) => x.endsWith('.js'))) {
  const p = path.join(dbDir, f);
  const o = overrides[f];
  const exports = o ? new Proxy(o, { get: (t, k) => (k in t ? t[k] : inert) }) : inert;
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const { loadCommands } = require('../src/handlers/commandHandler');
const router = require('../src/ai/router');
const { handleButton } = require('../src/ai/actions');

const client = {};
loadCommands(client);
const BOT = '999999999999999999';
client.user = { id: BOT, displayAvatarURL: () => null };
const reg = router.buildRegistry(client.commands, client.aliases);

// ---- fakes ----
let seq = 0;
const uid = () => String(100000000000000000n + BigInt(++seq));

function member(id, { username = `user${id.slice(-3)}`, pos = 1, perms = () => true } = {}) {
  return {
    id, displayName: username, user: { id, username, tag: username, bot: false },
    roles: { highest: { position: pos } },
    permissions: { has: (p) => perms(p) },
  };
}

function world({ invoker, others = [] }) {
  const guildId = uid();
  const all = new Collection([invoker, ...others].map((m) => [m.id, m]));
  const guild = {
    id: guildId, ownerId: 'nobody', client,
    members: {
      cache: all,
      fetch: async (arg) => { const id = typeof arg === 'string' ? arg : arg.user; const m = all.get(id); if (!m) throw new Error('unknown'); return m; },
      search: async ({ query }) => all.filter((m) => m.user.username.toLowerCase().startsWith(query.toLowerCase())),
    },
    roles: { cache: new Collection() },
    channels: { cache: new Collection() },
  };
  return guild;
}

function msg(guild, invoker, content, mentionIds = []) {
  const replies = [];
  const m = {
    content, guild, client, author: invoker.user, member: invoker,
    channel: { id: uid(), name: 'general' },
    mentions: { users: new Map(mentionIds.map((id) => [id, {}])), roles: new Map(), channels: new Map() },
    reply: async (payload) => { replies.push(payload); return { edit: async () => {} }; },
  };
  m.replies = replies;
  return m;
}

function deps(answer, calls) {
  return {
    prefix: ';',
    canInvokeAi: () => true,
    runPrefix: async (m) => { calls.run.push(m.content); },
    ask: async () => { calls.asked++; return typeof answer === 'function' ? answer() : answer; },
  };
}
const newCalls = () => ({ run: [], asked: 0 });

function interaction(guild, user, customId) {
  const out = { replies: [], updates: [], edits: [] };
  return Object.assign(out, {
    customId, guild, client, user: { id: user.id, tag: user.user.tag },
    reply: async (p) => { out.replies.push(p); },
    update: async (p) => { out.updates.push(p); },
    deferUpdate: async () => {},
    editReply: async (p) => { out.edits.push(p); },
  });
}
const buttonId = (reply, which) => reply.components[0].components.find((b) => b.data.custom_id.endsWith(`:${which}`)).data.custom_id;
const text = (p) => JSON.stringify(p);

// ---- parsing ----
test('parseRoute fails closed', () => {
  const ok = new Set(['rank', 'bank balance']);
  assert.deepStrictEqual(router.parseRoute('{"command":"rank","args":[]}', ok), { command: 'rank', args: [] });
  assert.deepStrictEqual(router.parseRoute('```json\n{"command":"Bank Balance"}\n```', ok), { command: 'bank balance', args: [] });
  assert.deepStrictEqual(router.parseRoute('{"none":true}', ok), { none: true });
  for (const bad of [
    null, '', 'rank', '{', '[]', '"rank"', '{"command":"ban","args":[]}', // not offered
    '{"command":"rank","args":[],"confirm":false}', // extra field
    '{"none":true,"command":"rank"}', '{"none":"true"}', '{"command":5}', '{"command":"rank","args":"me"}',
    '{"command":"rank","args":[1]}', `{"command":"rank","args":["${'x'.repeat(400)}"]}`, '{"command":"rank","args":[null]}',
  ]) assert.strictEqual(router.parseRoute(bad, ok), null, String(bad));
});

// ---- shortlist ----
test('shortlist picks the right command for sample sentences', () => {
  const cases = [
    ["mofu what's my balance", 'bank balance'],
    ['mofu show my rank', 'rank'],
    ['mofu remind me in 10m to drink water', 'remind set'],
    ['mofu give riri 100 coins', 'transfer'],
    ['mofu ban @x spam', 'ban'],
    ['mofu kya mera balance dikhao', 'bank balance'],
    ['mofu show riri avatar', 'avatar'],
    ['mofu flip a coin for 50', 'coinflip'],
    ['mofu clear 20 messages', 'purge'],
    ['mofu define rizz', 'define'],
    ['mofu claim my daily', 'daily'],
    ['mofu whats the ping', 'ping'],
    ['mofu translate hola to english', 'translate'],
    ['mofu rnak', 'rank'], // typo
    ['mofuuu skip this song', 'skip'],
    ['mofu deposit 500', 'bank deposit'],
    ['mofu set slowmode to 10', 'slowmode'],
  ];
  for (const [s, want] of cases) {
    const keys = router.shortlist(s, reg).map((x) => x.entry.key);
    const at = keys.indexOf(want);
    assert.ok(at >= 0 && at < 5, `${s} -> ${want} not in top 5: ${keys.slice(0, 5).join(', ')}`);
  }
  // nothing command-like: no strong match, so no model call
  for (const s of ['mofu how are you', 'mofu lol', 'mofu good morning']) {
    const top = router.shortlist(s, reg)[0];
    assert.ok(!top || !top.strong, `${s} matched ${top && top.entry.key}`);
  }
});

// ---- tiers ----
test('every command is classified, and anything not listed defaults to confirm', () => {
  const names = new Set(reg.entries.map((e) => e.name));
  for (const k of [...router.RUN_NOW, ...router.BLOCKED]) {
    assert.ok(reg.byKey.has(k) || names.has(k), `tier table names a command that does not exist: ${k}`);
  }
  for (const e of reg.entries) {
    const t = router.tierOf(e);
    assert.ok(['run', 'confirm', 'blocked'].includes(t), e.key);
    if (e.perm) assert.notStrictEqual(t, 'run', `${e.key} needs a permission but runs without confirm`);
  }
  assert.strictEqual(router.tierOf({ key: 'brandnew', name: 'brandnew', perm: null }), 'confirm');
  assert.strictEqual(router.tierOf(undefined), 'blocked');
  for (const k of ['ban', 'kick', 'purge', 'role', 'setlevel', 'transfer', 'coinflip', 'slots', 'rob', 'lock on', 'prefix', 'shop buy', 'warn add']) {
    assert.strictEqual(router.tierOf(reg.byKey.get(k)), 'confirm', k);
  }
  for (const k of ['rank', 'bank balance', 'help', 'avatar', 'remind set', 'ping', 'nowplaying', 'define', 'calculate']) {
    assert.strictEqual(router.tierOf(reg.byKey.get(k)), 'run', k);
  }
  for (const k of ['backup', 'import', 'forgetme', 'antinuke', 'antiraid', 'setup', 'quicksetup', 'aiactions', 'airoles']) {
    assert.ok(router.BLOCKED.has(k), k);
  }
});

// ---- routing ----
test('a read-only command runs through the prefix path (content rewritten)', async () => {
  const me = member(uid());
  const g = world({ invoker: me });
  const calls = newCalls();
  const m = msg(g, me, "mofu what's my balance");
  assert.strictEqual(await router.routeMessage(m, deps('{"command":"bank balance","args":[]}', calls)), true);
  assert.deepStrictEqual(calls.run, [';bank balance']);
  assert.strictEqual(m.content, ';bank balance');

  const m2 = msg(g, member(uid()), 'mofu remind me in 10m to drink water');
  const c2 = newCalls();
  await router.routeMessage(m2, deps('{"command":"remind set","args":["10m","drink water"]}', c2));
  assert.deepStrictEqual(c2.run, [';remind set 10m drink water']);
});

test('model down, over budget or "none" falls through to chat', async () => {
  for (const answer of [null, '{"none":true}', 'sure! i will check your balance']) {
    const me = member(uid());
    const calls = newCalls();
    const m = msg(world({ invoker: me }), me, "mofu what's my balance");
    assert.strictEqual(await router.routeMessage(m, deps(answer, calls)), false);
    assert.deepStrictEqual(calls.run, []);
    assert.strictEqual(m.replies.length, 0);
  }
});

test('plain chat never reaches the model', async () => {
  const me = member(uid());
  const calls = newCalls();
  assert.strictEqual(await router.routeMessage(msg(world({ invoker: me }), me, 'mofu how are you'), deps('{"command":"rank"}', calls)), false);
  assert.strictEqual(calls.asked, 0);
});

test('blocklisted commands never route', async () => {
  const me = member(uid());
  const calls = newCalls();
  const m = msg(world({ invoker: me }), me, 'mofu backup export');
  assert.strictEqual(await router.routeMessage(m, deps('{"command":"backup export","args":[]}', calls)), true);
  assert.strictEqual(calls.asked, 0);
  assert.deepStrictEqual(calls.run, []);
  assert.match(text(m.replies[0]), /stays typed/);

  // even if a blocked command were named by the model, it is never in the offered set
  const me2 = member(uid());
  const c2 = newCalls();
  const m2 = msg(world({ invoker: me2 }), me2, 'mofu export the server settings please');
  await router.routeMessage(m2, deps('{"command":"backup export","args":[]}', c2));
  assert.deepStrictEqual(c2.run, []);
  assert.ok(!m2.replies.some((r) => /PROPOSAL/.test(text(r))));
});

test('hostile sentences and hostile model output yield no action', async () => {
  const target = uid();
  const answers = [
    '{"command":"ban","args":["everyone"]}', // not a person
    '{"command":"ban","args":["@everyone","raid"]}',
    '{"command":"nuke","args":[]}', // unknown command
    '{"command":"ban","args":["<@' + target + '>"],"skip_confirm":true}', // extra field
    '{"command":"ban","args":["<@123456789012345678>","x"]}', // an id nobody mentioned
    '{"command":"ban","args":["<@' + target + '>","0","a","b","c"]}', // more args than options
  ];
  for (const answer of answers) {
    const me = member(uid());
    const g = world({ invoker: me, others: [member(target)] });
    const calls = newCalls();
    const m = msg(g, me, `mofu ban everyone <@${target}>`, [target]);
    assert.strictEqual(await router.routeMessage(m, deps(answer, calls)), false, answer);
    assert.deepStrictEqual(calls.run, [], answer);
    assert.ok(!m.replies.some((r) => /PROPOSAL/.test(text(r))), answer);
  }
});

test('risky commands need a confirm card: only the requester, permissions re-checked at press', async () => {
  const targetId = uid();
  let canBan = true;
  const me = member(uid(), { username: 'mod', pos: 5, perms: () => canBan });
  const stranger = member(uid(), { username: 'stranger', pos: 9 });
  const g = world({ invoker: me, others: [member(targetId, { username: 'riri', pos: 1 }), stranger] });
  const answer = `{"command":"ban","args":["<@${targetId}>","","spam"]}`;

  // 1. card posted, nothing ran yet
  const calls = newCalls();
  const m = msg(g, me, `mofu ban <@${targetId}> spam`, [targetId]);
  assert.strictEqual(await router.routeMessage(m, deps(answer, calls)), true);
  assert.deepStrictEqual(calls.run, []);
  const card = m.replies.find((r) => /AI COMMAND PROPOSAL/.test(text(r)));
  assert.ok(card, 'no confirm card');
  assert.match(text(card), /;ban @riri 0 spam/);

  // 2. someone else presses: refused, still pending
  const other = interaction(g, stranger, buttonId(card, 'ok'));
  await handleButton(other);
  assert.match(text(other.replies[0]), /only/);
  assert.deepStrictEqual(calls.run, []);

  // 3. requester lost the permission before pressing: not done
  canBan = false;
  const press = interaction(g, me, buttonId(card, 'ok'));
  await handleButton(press);
  assert.match(text(press.edits[0]), /NOT DONE/);
  assert.deepStrictEqual(calls.run, []);

  // 4. fresh request with the permission: confirm runs the exact line through the prefix path
  canBan = true;
  const m2 = msg(g, me, `mofu ban <@${targetId}> spam`, [targetId]);
  const c2 = newCalls();
  await new Promise((r) => setTimeout(r, 0));
  router._resetCooldown?.();
  await router.routeMessage(m2, { ...deps(answer, c2) });
  const card2 = m2.replies.find((r) => /AI COMMAND PROPOSAL/.test(text(r)));
  assert.ok(card2, 'second card');
  await handleButton(interaction(g, me, buttonId(card2, 'ok')));
  assert.deepStrictEqual(c2.run, [`;ban <@${targetId}> 0 spam`]);
  assert.strictEqual(m2.content, `;ban <@${targetId}> 0 spam`);

  // 5. the same button twice does nothing more
  await handleButton(interaction(g, me, buttonId(card2, 'ok')));
  assert.strictEqual(c2.run.length, 1);
});

test('confirm card refuses up front when the requester lacks the permission or outranks nobody', async () => {
  const targetId = uid();
  const answer = `{"command":"ban","args":["<@${targetId}>"]}`;
  // no permission
  const me = member(uid(), { perms: () => false });
  const m = msg(world({ invoker: me, others: [member(targetId)] }), me, `mofu ban <@${targetId}>`, [targetId]);
  const calls = newCalls();
  assert.strictEqual(await router.routeMessage(m, deps(answer, calls)), true);
  assert.ok(!m.replies.some((r) => /PROPOSAL/.test(text(r))));
  assert.match(text(m.replies[0]), /permission/);
  // target has a higher role
  const me2 = member(uid(), { pos: 2 });
  const m2 = msg(world({ invoker: me2, others: [member(targetId, { pos: 7 })] }), me2, `mofu ban <@${targetId}>`, [targetId]);
  await router.routeMessage(m2, deps(answer, newCalls()));
  assert.match(text(m2.replies[0]), /higher or equal role/);
});

test('typed names are resolved by code, money moves are confirmed', async () => {
  const riri = member(uid(), { username: 'riri' });
  const me = member(uid());
  const g = world({ invoker: me, others: [riri] });
  const calls = newCalls();
  const m = msg(g, me, 'mofu give riri 100 coins');
  assert.strictEqual(await router.routeMessage(m, deps('{"command":"transfer","args":["riri","100"]}', calls)), true);
  assert.deepStrictEqual(calls.run, []);
  const card = m.replies.find((r) => /PROPOSAL/.test(text(r)));
  assert.match(text(card), /;transfer @riri 100/);
  await handleButton(interaction(g, me, buttonId(card, 'ok')));
  assert.deepStrictEqual(calls.run, [`;transfer <@${riri.id}> 100`]);

  // unknown name: told, nothing proposed
  const me2 = member(uid());
  const m2 = msg(world({ invoker: me2 }), me2, 'mofu give zed 100 coins');
  assert.strictEqual(await router.routeMessage(m2, deps('{"command":"transfer","args":["zed","100"]}', newCalls())), true);
  assert.match(text(m2.replies[0]), /couldn't find/);
});

test('the chat prompt no longer claims there is no command for things', () => {
  const { BOT_SYSTEM } = require('../src/utils/ai');
  assert.doesNotMatch(BOT_SYSTEM, /can't ban or anything else/);
  assert.match(BOT_SYSTEM, /plain words/);
  assert.match(BOT_SYSTEM, /\/help/);
});
