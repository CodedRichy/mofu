const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolated XP db; the config store is a fake passed via deps, so data/sonder.db is never opened.
const DB = path.join(os.tmpdir(), `sonder-xp-flow-${process.pid}.db`);
process.env.SONDER_XP_DB = DB;
const xpDb = require('../src/database/xp');
const lv = require('../src/utils/xp');
const voiceXp = require('../src/events/voiceXp');

test.after(() => {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) { try { fs.unlinkSync(f); } catch { /* open on windows */ } }
});

const quietLog = { warn() {}, info() {}, error() {}, debug() {} };
const SF = (n) => `2000000000000000${String(n).padStart(3, '0')}`;

function fakeStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getConfig: (g, k) => (data.has(k) ? JSON.parse(JSON.stringify(data.get(k))) : null),
    setConfig: (g, k, v) => (v === null || v === undefined ? data.delete(k) : data.set(k, v)),
    _data: data,
  };
}

// Fake guild with roles; role.editable reflects whether the bot can assign it.
function fakeGuild(id, roleDefs = []) {
  const roles = new Map(roleDefs.map((r) => [r.id, { managed: false, editable: true, ...r }]));
  const sent = [];
  const channels = new Map();
  const guild = {
    id, name: 'Test Server', client: { user: { displayAvatarURL: () => undefined } },
    afkChannelId: null,
    roles: { cache: roles },
    channels: { cache: channels },
    members: { me: null },
    voiceStates: { cache: new Map() },
    _sent: sent,
  };
  return guild;
}

function fakeChannel(id, sent, extra = {}) {
  return { id, parentId: null, parent: null, send: async (payload) => { sent.push({ channel: id, payload }); return {}; }, ...extra };
}

function fakeMember(guild, id, roleIds = [], { failAdd = false } = {}) {
  const cache = new Map(roleIds.map((r) => [r, { id: r }]));
  const calls = [];
  return {
    id, guild,
    user: { id, bot: false, displayAvatarURL: () => 'https://x/a.png' },
    roles: {
      cache,
      add: async (rid, reason) => { calls.push(['add', rid, reason]); if (failAdd) throw new Error('Missing Permissions'); cache.set(rid, { id: rid }); },
      remove: async (rid) => { calls.push(['remove', rid]); cache.delete(rid); },
    },
    isCommunicationDisabled: () => false,
    _calls: calls,
  };
}

test('awardXp applies the multiplier and grants every earned reward on level-up (stack)', async () => {
  const guild = fakeGuild('g-stack', [{ id: SF(1) }, { id: SF(2) }, { id: SF(3) }]);
  const store = fakeStore({
    level_roles: [{ level: 1, role: SF(1) }, { level: 2, role: SF(2) }, { level: 50, role: SF(3) }],
    xp_role_multipliers: { [SF(9)]: 4 },
    xp_multiplier: 2,
  });
  const member = fakeMember(guild, 'u1', [SF(9)]);
  const channel = fakeChannel('c1', guild._sent);
  // 40 base x (4 role x 2 global = 8) = 320 xp -> level 0 needs 100, level 1 needs 155 -> level 2
  const r = await lv.awardXp({ member, channel, base: 40, fallback: channel }, { store, xpDb, log: quietLog });
  assert.strictEqual(r.multiplier, 8);
  assert.strictEqual(r.amount, 320);
  assert.strictEqual(r.level, 2);
  assert.ok(member.roles.cache.has(SF(1)) && member.roles.cache.has(SF(2)));
  assert.ok(!member.roles.cache.has(SF(3)));
  // announced with the default card in the fallback channel, no pings at all
  assert.strictEqual(guild._sent.length, 1);
  assert.deepStrictEqual(guild._sent[0].payload.allowedMentions, { parse: [] });
  assert.match(guild._sent[0].payload.embeds[0].data.description, /0 -> \*\*2\*\*/);
});

test('replace mode swaps the lower reward for the higher one', async () => {
  const guild = fakeGuild('g-replace', [{ id: SF(1) }, { id: SF(2) }]);
  const store = fakeStore({ level_roles: [{ level: 1, role: SF(1) }, { level: 2, role: SF(2) }], levelrole_mode: 'replace' });
  const member = fakeMember(guild, 'u2', [SF(1)]);
  const out = await lv.applyLevelRoles(member, 3, { store, log: quietLog });
  assert.deepStrictEqual(out.added, [SF(2)]);
  assert.deepStrictEqual(out.removed, [SF(1)]);
  assert.deepStrictEqual([...member.roles.cache.keys()], [SF(2)]);
});

test('grant-time hierarchy check and API failures never throw', async () => {
  const guild = fakeGuild('g-fail', [{ id: SF(1), editable: false }, { id: SF(2), managed: true }, { id: SF(3) }]);
  const store = fakeStore({ level_roles: [{ level: 1, role: SF(1) }, { level: 1, role: SF(2) }, { level: 1, role: SF(3) }, { level: 1, role: SF(4) }] });
  const member = fakeMember(guild, 'u3', [], { failAdd: true });
  const out = await lv.applyLevelRoles(member, 5, { store, log: quietLog });
  assert.deepStrictEqual(out.added, []);
  assert.strictEqual(out.failed.length, 4); // above bot, managed, API error, deleted role
  // only the assignable role was actually attempted
  assert.deepStrictEqual(member._calls.map((c) => c[1]), [SF(3)]);
  // a totally broken member object is swallowed too
  const broken = await lv.applyLevelRoles({ guild, roles: null }, 5, { store, log: quietLog });
  assert.deepStrictEqual(broken, { added: [], removed: [], failed: [] });
});

test('no-XP channels (incl. category) and roles block XP without burning the cooldown', async () => {
  const guild = fakeGuild('g-ignore');
  const store = fakeStore({ no_xp_channels: ['cat1'], no_xp_roles: ['muted'] });
  const inCat = fakeChannel('c2', guild._sent, { parentId: 'cat1', parent: { parentId: null } });
  const member = fakeMember(guild, 'u4');
  assert.strictEqual(await lv.awardXp({ member, channel: inCat, base: 20, cooldownMs: 60000 }, { store, xpDb, log: quietLog }), null);
  const muted = fakeMember(guild, 'u5', ['muted']);
  assert.strictEqual(await lv.awardXp({ member: muted, channel: fakeChannel('c3', guild._sent), base: 20, cooldownMs: 60000 }, { store, xpDb, log: quietLog }), null);
  // the ignored message did not set the cooldown, so a normal one right after still earns
  const ok = await lv.awardXp({ member, channel: fakeChannel('c3', guild._sent), base: 20, cooldownMs: 60000 }, { store, xpDb, log: quietLog });
  assert.strictEqual(ok.amount, 20);
  // and the cooldown now holds
  assert.strictEqual(await lv.awardXp({ member, channel: fakeChannel('c3', guild._sent), base: 20, cooldownMs: 60000 }, { store, xpDb, log: quietLog }), null);
  // leveling off: nothing
  const off = fakeStore({ leveling: false });
  assert.strictEqual(await lv.awardXp({ member: fakeMember(guild, 'u6'), channel: fakeChannel('c3', guild._sent), base: 20 }, { store: off, xpDb, log: quietLog }), null);
});

test('custom level-up message pings only the member; toggle off and configured channel are honoured', async () => {
  const guild = fakeGuild('g-msg');
  const levelCh = fakeChannel('lvl', guild._sent);
  guild.channels.cache.set('lvl', levelCh);
  const store = fakeStore({ levelup_message: 'GG {user}, level {level} in {server}! @everyone', levelup_channel: 'lvl' });
  const user = { id: '42', displayAvatarURL: () => '' };
  const fallback = fakeChannel('here', guild._sent);
  assert.strictEqual(await lv.announceLevelUp({ guild, user, oldLevel: 1, newLevel: 2, fallback }, { store }), true);
  const sent = guild._sent.pop();
  assert.strictEqual(sent.channel, 'lvl');
  assert.strictEqual(sent.payload.content, 'GG <@42>, level 2 in Test Server! @​everyone');
  assert.deepStrictEqual(sent.payload.allowedMentions, { parse: [], users: ['42'] });

  store.setConfig('g-msg', 'levelup_announce', false);
  assert.strictEqual(await lv.announceLevelUp({ guild, user, oldLevel: 1, newLevel: 2, fallback }, { store }), false);
  assert.strictEqual(guild._sent.length, 0);

  // a send that rejects is swallowed
  const bad = fakeStore({});
  assert.strictEqual(await lv.announceLevelUp({ guild, user, oldLevel: 1, newLevel: 2, fallback: { send: async () => { throw new Error('x'); } } }, { store: bad }), false);
});

test('voice sweep pays from the second minute, respects config, and forgets people who left', async () => {
  const guild = fakeGuild('g-voice');
  const vc = { id: 'vc1', parentId: null, parent: null };
  guild.channels.cache.set('vc1', vc);
  const a = fakeMember(guild, 'va');
  const b = fakeMember(guild, 'vb');
  const state = (m) => ({ channelId: 'vc1', selfDeaf: false, serverDeaf: false, serverMute: false, member: m });
  guild.voiceStates.cache.set('va', state(a));
  guild.voiceStates.cache.set('vb', state(b));
  const client = { guilds: { cache: new Map([[guild.id, guild]]) } };
  const store = fakeStore({ voicexp_enabled: true, voicexp_rate: 7, xp_channel_multipliers: { vc1: 2 } });
  const deps = { store, xpDb, log: quietLog };

  voiceXp.stop();
  await voiceXp.sweep(client, deps);
  assert.strictEqual(xpDb.getStats('g-voice', 'va').totalXp, 0); // first sweep only starts the clock
  assert.strictEqual(voiceXp._seenSize(), 2);
  await voiceXp.sweep(client, deps);
  assert.strictEqual(xpDb.getStats('g-voice', 'va').totalXp, 14); // 7/min x 2 channel multiplier
  assert.strictEqual(xpDb.getStats('g-voice', 'vb').totalXp, 14);

  // b leaves: a is now alone, nobody earns, and both drop out of memory
  guild.voiceStates.cache.delete('vb');
  await voiceXp.sweep(client, deps);
  assert.strictEqual(xpDb.getStats('g-voice', 'va').totalXp, 14);
  assert.strictEqual(voiceXp._seenSize(), 0);

  // disabled guild: nothing tracked at all
  guild.voiceStates.cache.set('vb', state(b));
  store.setConfig('g-voice', 'voicexp_enabled', null);
  await voiceXp.sweep(client, deps);
  await voiceXp.sweep(client, deps);
  assert.strictEqual(voiceXp._seenSize(), 0);
  assert.strictEqual(xpDb.getStats('g-voice', 'vb').totalXp, 14);
  voiceXp.stop();
});

test('getMembersAtLevel returns members past a level, highest first, capped', () => {
  xpDb.setLevel('g-sync', 'low', 1);
  xpDb.setLevel('g-sync', 'mid', 5);
  xpDb.setLevel('g-sync', 'top', 9);
  assert.deepStrictEqual(xpDb.getMembersAtLevel('g-sync', 5, 10).map((r) => r.userId), ['top', 'mid']);
  assert.strictEqual(xpDb.getMembersAtLevel('g-sync', 0, 1).length, 1);
});
