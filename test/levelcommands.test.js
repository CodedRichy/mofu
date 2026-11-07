const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');

// Never touch data/sonder.db: isolated XP db, and the config store replaced in the require cache before any
// command module loads it.
process.env.SONDER_XP_DB = path.join(os.tmpdir(), `sonder-xp-cmd-${process.pid}.db`);
const data = new Map();
const fakeStore = {
  getConfig: (g, k) => (data.has(`${g}:${k}`) ? JSON.parse(JSON.stringify(data.get(`${g}:${k}`))) : null),
  setConfig: (g, k, v) => (v === null || v === undefined ? data.delete(`${g}:${k}`) : data.set(`${g}:${k}`, v)),
};
const storePath = require.resolve('../src/database/store');
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: fakeStore };

const { ChannelType } = require('discord.js');
const PrefixContext = require('../src/utils/prefixContext');
const levelrole = require('../src/commands/leveling/levelrole');
const xpmultiplier = require('../src/commands/leveling/xpmultiplier');
const xpignore = require('../src/commands/leveling/xpignore');
const levelup = require('../src/commands/leveling/levelup');
const leveling = require('../src/commands/leveling/leveling');

const G = '3999999999999999999';
const SF = (n) => `3000000000000000${String(n).padStart(3, '0')}`;

function walkOptions(opts, fn) {
  for (const o of opts || []) { fn(o); walkOptions(o.options, fn); }
}

test('new commands are valid slash payloads within Discord limits', () => {
  for (const cmd of [levelrole, xpmultiplier, xpignore, levelup, leveling]) {
    const json = cmd.data.toJSON();
    assert.ok(/^[a-z]{1,32}$/.test(json.name), json.name);
    assert.ok(json.description.length >= 1 && json.description.length <= 100, `${json.name} description`);
    assert.ok((json.options || []).length <= 25, `${json.name} option count`);
    assert.ok(typeof cmd.execute === 'function');
    assert.ok(json.default_member_permissions, `${json.name} must be staff-only`);
    walkOptions(json.options, (o) => {
      assert.ok(o.description.length <= 100, `${json.name}.${o.name} description too long (${o.description.length})`);
      assert.ok((o.choices || []).length <= 25);
      // PrefixContext only understands top-level subcommands, never groups
      assert.notStrictEqual(o.type, 2, `${json.name} uses a subcommand group`);
    });
  }
});

// ---------- fake guild / interaction ----------

function makeGuild() {
  const roles = new Map();
  const addRole = (id, extra = {}) => roles.set(id, { id, name: `r${id.slice(-3)}`, position: 5, managed: false, editable: true, toString: () => `<@&${id}>`, ...extra });
  addRole(G, { position: 0 }); // @everyone
  const channels = new Map();
  channels.set(SF(500), { id: SF(500), type: ChannelType.GuildText, permissionsFor: () => ({ has: () => true }) });
  channels.set(SF(501), { id: SF(501), type: ChannelType.GuildCategory });
  channels.set(SF(502), { id: SF(502), type: ChannelType.DM });
  return {
    id: G, name: 'Srv', ownerId: 'owner',
    roles: { cache: roles }, channels: { cache: channels },
    members: { me: { id: 'bot' }, cache: new Map() },
    _addRole: addRole,
  };
}

function interaction(guild, sub, opts = {}) {
  const replies = [];
  const i = {
    guild, guildId: guild.id, client: { user: { displayAvatarURL: () => undefined } },
    user: { id: 'owner' },
    member: { id: 'owner', roles: { highest: { position: 100 } } },
    replies,
    options: {
      getSubcommand: () => sub,
      getInteger: (n) => opts[n] ?? null,
      getNumber: (n) => opts[n] ?? null,
      getString: (n) => opts[n] ?? null,
      getRole: (n) => (opts[n] ? guild.roles.cache.get(opts[n]) || null : null),
      getChannel: (n) => (opts[n] ? guild.channels.cache.get(opts[n]) || null : null),
    },
    reply: async (p) => { replies.push(p); return p; },
    deferReply: async () => { i.deferred = true; },
    editReply: async (p) => { replies.push(p); return p; },
  };
  return i;
}
const text = (p) => p.embeds[0].data.description;

test('/levelrole add validates the role and caps at 25 rewards', async () => {
  data.clear();
  const guild = makeGuild();
  guild._addRole(SF(1));
  guild._addRole(SF(2), { managed: true });
  guild._addRole(SF(3), { editable: false });

  let i = interaction(guild, 'add', { level: 5, role: SF(1) });
  await levelrole.execute(i);
  assert.match(text(i.replies[0]), /level \*\*5\*\*/);
  assert.deepStrictEqual(fakeStore.getConfig(G, 'level_roles'), [{ level: 5, role: SF(1) }]);

  for (const [role, re] of [[SF(2), /managed/], [SF(3), /can't manage|can't assign/], [G, /@everyone/]]) {
    i = interaction(guild, 'add', { level: 5, role });
    await levelrole.execute(i);
    assert.match(text(i.replies[0]), re);
    assert.strictEqual(i.replies[0].ephemeral, true);
  }

  // moving an existing reward to another level does not duplicate it
  i = interaction(guild, 'add', { level: 7, role: SF(1) });
  await levelrole.execute(i);
  assert.deepStrictEqual(fakeStore.getConfig(G, 'level_roles'), [{ level: 7, role: SF(1) }]);

  for (let n = 10; n < 34; n++) {
    guild._addRole(SF(n));
    await levelrole.execute(interaction(guild, 'add', { level: n, role: SF(n) }));
  }
  assert.strictEqual(fakeStore.getConfig(G, 'level_roles').length, 25);
  guild._addRole(SF(99));
  i = interaction(guild, 'add', { level: 99, role: SF(99) });
  await levelrole.execute(i);
  assert.match(text(i.replies[0]), /at most 25/);

  // list fits Discord's description limit
  i = interaction(guild, 'list');
  await levelrole.execute(i);
  assert.ok(text(i.replies[0]).length <= 4096);

  // remove by level and by role
  await levelrole.execute(interaction(guild, 'remove', { reward: '7' }));
  await levelrole.execute(interaction(guild, 'remove', { reward: `<@&${SF(10)}>` }));
  assert.strictEqual(fakeStore.getConfig(G, 'level_roles').length, 23);
  i = interaction(guild, 'remove', { reward: 'nonsense' });
  await levelrole.execute(i);
  assert.strictEqual(i.replies[0].ephemeral, true);
});

test('/xpmultiplier sets, clears with 1, lists and removes', async () => {
  data.clear();
  const guild = makeGuild();
  guild._addRole(SF(1));
  await xpmultiplier.execute(interaction(guild, 'role', { role: SF(1), x: 2.5 }));
  await xpmultiplier.execute(interaction(guild, 'channel', { channel: SF(501), x: 1.5 }));
  await xpmultiplier.execute(interaction(guild, 'global', { x: 3 }));
  assert.deepStrictEqual(fakeStore.getConfig(G, 'xp_role_multipliers'), { [SF(1)]: 2.5 });
  assert.deepStrictEqual(fakeStore.getConfig(G, 'xp_channel_multipliers'), { [SF(501)]: 1.5 });
  assert.strictEqual(fakeStore.getConfig(G, 'xp_multiplier'), 3);

  let i = interaction(guild, 'global', { x: 7 }); // out of range even if Discord's own check is bypassed
  await xpmultiplier.execute(i);
  assert.strictEqual(i.replies[0].ephemeral, true);
  i = interaction(guild, 'channel', { channel: SF(502), x: 2 }); // DM type is refused
  await xpmultiplier.execute(i);
  assert.strictEqual(i.replies[0].ephemeral, true);

  i = interaction(guild, 'list');
  await xpmultiplier.execute(i);
  assert.match(text(i.replies[0]), /2\.5x/);

  await xpmultiplier.execute(interaction(guild, 'role', { role: SF(1), x: 1 }));
  assert.strictEqual(fakeStore.getConfig(G, 'xp_role_multipliers'), null);
  await xpmultiplier.execute(interaction(guild, 'remove', { target: SF(501) }));
  await xpmultiplier.execute(interaction(guild, 'remove', { target: 'global' }));
  assert.strictEqual(fakeStore.getConfig(G, 'xp_channel_multipliers'), null);
  assert.strictEqual(fakeStore.getConfig(G, 'xp_multiplier'), null);
});

test('/xpignore adds, refuses duplicates and @everyone, and removes', async () => {
  data.clear();
  const guild = makeGuild();
  guild._addRole(SF(1));
  await xpignore.execute(interaction(guild, 'channel', { action: 'add', channel: SF(500) }));
  await xpignore.execute(interaction(guild, 'role', { action: 'add', role: SF(1) }));
  assert.deepStrictEqual(fakeStore.getConfig(G, 'no_xp_channels'), [SF(500)]);
  assert.deepStrictEqual(fakeStore.getConfig(G, 'no_xp_roles'), [SF(1)]);
  let i = interaction(guild, 'channel', { action: 'add', channel: SF(500) });
  await xpignore.execute(i);
  assert.match(text(i.replies[0]), /Already/);
  i = interaction(guild, 'role', { action: 'add', role: G });
  await xpignore.execute(i);
  assert.strictEqual(i.replies[0].ephemeral, true);
  await xpignore.execute(interaction(guild, 'channel', { action: 'remove', channel: SF(500) }));
  assert.strictEqual(fakeStore.getConfig(G, 'no_xp_channels'), null);
});

test('/levelup message caps length, previews safely, resets; toggle and channel', async () => {
  data.clear();
  const guild = makeGuild();
  let i = interaction(guild, 'message', { text: 'x'.repeat(301) });
  await levelup.execute(i);
  assert.strictEqual(i.replies[0].ephemeral, true);
  i = interaction(guild, 'message', { text: 'GG {user} @everyone level {level}' });
  await levelup.execute(i);
  assert.strictEqual(fakeStore.getConfig(G, 'levelup_message'), 'GG {user} @everyone level {level}');
  assert.deepStrictEqual(i.replies[0].allowedMentions, { parse: [] });
  await levelup.execute(interaction(guild, 'message', { text: 'reset' }));
  assert.strictEqual(fakeStore.getConfig(G, 'levelup_message'), null);
  await levelup.execute(interaction(guild, 'toggle', { state: 'off' }));
  assert.strictEqual(fakeStore.getConfig(G, 'levelup_announce'), false);
  await levelup.execute(interaction(guild, 'toggle', { state: 'on' }));
  assert.strictEqual(fakeStore.getConfig(G, 'levelup_announce'), null);
  await levelup.execute(interaction(guild, 'channel', { channel: SF(500) }));
  assert.strictEqual(fakeStore.getConfig(G, 'levelup_channel'), SF(500));
});

test('/leveling voice stores the switch and rate', async () => {
  data.clear();
  const guild = makeGuild();
  await leveling.execute(interaction(guild, 'voice', { state: 'on', rate: 8 }));
  assert.strictEqual(fakeStore.getConfig(G, 'voicexp_enabled'), true);
  assert.strictEqual(fakeStore.getConfig(G, 'voicexp_rate'), 8);
  const i = interaction(guild, 'settings');
  await leveling.execute(i);
  assert.match(text(i.replies[0]), /Voice XP\*\* On \(8\/min\)/);
});

// ---------- prefix parsing: every new command must work as ;command too ----------

function prefixCtx(cmd, argStr, guild) {
  const users = new Map();
  const message = {
    guild, channel: {}, author: { id: 'owner' }, member: {}, client: { users: { cache: users } },
    guildId: guild.id, channelId: 'c', createdTimestamp: 0, attachments: new Map(),
  };
  return new PrefixContext(message, argStr.split(/\s+/).filter(Boolean), cmd);
}

test('prefix forms parse into the same options', () => {
  const guild = makeGuild();
  guild._addRole(SF(1));
  let ctx = prefixCtx(levelrole, `add 10 <@&${SF(1)}>`, guild);
  assert.deepStrictEqual([ctx._missingArgs, ctx._invalid], [[], []]);
  assert.strictEqual(ctx.options.getSubcommand(), 'add');
  assert.strictEqual(ctx.options.getInteger('level'), 10);
  assert.strictEqual(ctx.options.getRole('role').id, SF(1));

  ctx = prefixCtx(levelrole, 'add 0 x', guild);
  assert.ok(ctx._invalid.length >= 1);

  ctx = prefixCtx(levelrole, 'mode Replace', guild);
  assert.strictEqual(ctx.options.getString('mode'), 'replace');

  ctx = prefixCtx(xpmultiplier, `role ${SF(1)} 1.5`, guild);
  assert.deepStrictEqual(ctx._invalid, []);
  assert.strictEqual(ctx.options.getNumber('x'), 1.5);
  ctx = prefixCtx(xpmultiplier, 'global 9', guild);
  assert.match(ctx._invalid[0], /at most 5/);

  ctx = prefixCtx(xpignore, `channel add <#${SF(500)}>`, guild);
  assert.deepStrictEqual(ctx._invalid, []);
  assert.strictEqual(ctx.options.getString('action'), 'add');
  assert.strictEqual(ctx.options.getChannel('channel').id, SF(500));

  ctx = prefixCtx(levelup, 'message GG {user} you hit {level}', guild);
  assert.strictEqual(ctx.options.getString('text'), 'GG {user} you hit {level}');
  ctx = prefixCtx(levelup, `message ${'y '.repeat(200)}`, guild);
  assert.match(ctx._invalid[0], /at most 300/);

  ctx = prefixCtx(leveling, 'voice on 12', guild);
  assert.strictEqual(ctx.options.getInteger('rate'), 12);
});
