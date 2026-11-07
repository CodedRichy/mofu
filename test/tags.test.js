// Tags: name/content rules, variable substitution, the database layer, and /tag through both slash and prefix.
// The config store is replaced in the require cache with an in-memory database, so data/sonder.db is never opened.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const Database = require('better-sqlite3');
const { PermissionsBitField } = require('discord.js');

const config = new Map();
const fakeStore = {
  db: new Database(':memory:'),
  getConfig: (g, k) => (config.has(`${g}:${k}`) ? JSON.parse(config.get(`${g}:${k}`)) : null),
  setConfig: (g, k, v) => { if (v === null || v === undefined) config.delete(`${g}:${k}`); else config.set(`${g}:${k}`, JSON.stringify(v)); },
};
const storePath = require.resolve(path.join(__dirname, '..', 'src', 'database', 'store.js'));
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: fakeStore };

const T = require('../src/utils/tags');
const { create } = require('../src/database/tags');
const tagCmd = require('../src/commands/utility/tag');
const PrefixContext = require('../src/utils/prefixContext');

const F = PermissionsBitField.Flags;
const G = '800000000000000001';

test('names: 1-32 of a-z 0-9 _ -, never a subcommand or an existing command', () => {
  const isCommand = (n) => n === 'ban';
  assert.strictEqual(T.nameError('rules', { isCommand }), null);
  assert.strictEqual(T.nameError('a_b-9', { isCommand }), null);
  assert.match(T.nameError('', { isCommand }), /name/);
  assert.match(T.nameError('x'.repeat(33), { isCommand }), /32/);
  for (const bad of ['Rules', 'two words', 'emoji\u{1F600}', 'a.b', '@everyone']) assert.ok(T.nameError(bad, { isCommand }), bad);
  assert.match(T.nameError('list', { isCommand }), /subcommand/);
  assert.match(T.nameError('ban', { isCommand }), /already a command/);
  assert.strictEqual(T.normalizeName('  Rules '), 'rules');
});

test('content: 1-1900 characters after trimming', () => {
  assert.ok(T.contentError('   '));
  assert.strictEqual(T.contentError('x'.repeat(1900)), null);
  assert.match(T.contentError('x'.repeat(1901)), /1900/);
});

test('renderTag substitutes the whitelist once, never re-expands {args}, never evaluates', () => {
  const ctx = {
    user: { id: '1', username: 'neo' }, member: { displayName: 'Neo' },
    guild: { name: 'Zion', memberCount: 42 }, channel: { id: '7' },
    args: '{server} ${process.exit()} {random:x|y}',
  };
  assert.strictEqual(T.renderTag('hi {user} / {user.name} in {server} {channel} ({membercount})', ctx), 'hi <@1> / Neo in Zion <#7> (42)');
  assert.strictEqual(T.renderTag('you said: {args}', ctx), 'you said: {server} ${process.exit()} {random:x|y}');
  assert.strictEqual(T.renderTag('{random:a|b|c}', ctx, () => 0), 'a');
  assert.strictEqual(T.renderTag('{random:a|b|c}', ctx, () => 0.99), 'c');
  assert.strictEqual(T.renderTag('{RANDOM:only}', ctx), 'only');
  assert.strictEqual(T.renderTag('{unknown} {user.tag}', ctx), '{unknown} {user.tag}');
  assert.strictEqual(T.renderTag('{args}', { ...ctx, args: 'z'.repeat(900) }).length, T.LIMITS.argsMax);
});

test('rawTail keeps line breaks and handles multi-character prefixes', () => {
  assert.strictEqual(T.rawTail(';tag create rules line one\nline two', ';', 3), 'line one\nline two');
  assert.strictEqual(T.rawTail('s! tag hello   a b', 's! ', 2), 'a b');
  assert.strictEqual(T.rawTail(';tag hello', ';', 2), '');
});

test('cooldown: 3s per key', () => {
  const cd = T.makeCooldown(3000);
  assert.strictEqual(cd.hit('u', 1000), 0);
  assert.strictEqual(cd.hit('u', 2000), 2000);
  assert.strictEqual(cd.hit('v', 2000), 0);
  assert.strictEqual(cd.hit('u', 4000), 0);
});

test('db: create / exists / cap, update keeps embed when unspecified, uses, search, delete', () => {
  const db = create(new Database(':memory:'));
  assert.strictEqual(db.createTag('g', { name: 'rules', content: 'be nice', embed: true, ownerId: 'u1' }), 'ok');
  assert.strictEqual(db.createTag('g', { name: 'rules', content: 'again' }), 'exists');
  assert.strictEqual(db.createTag('g2', { name: 'rules', content: 'other guild' }), 'ok');
  assert.ok(db.updateTag('g', 'rules', { content: 'be kind', by: 'u2' }));
  const t = db.getTag('g', 'rules');
  assert.deepStrictEqual([t.content, t.embed, t.updated_by], ['be kind', true, 'u2']);
  assert.ok(!db.updateTag('g', 'nope', { content: 'x' }));
  db.bumpUses('g', 'rules'); db.bumpUses('g', 'rules');
  assert.strictEqual(db.getTag('g', 'rules').uses, 2);
  db.createTag('g', { name: 'r_x', content: 'x' });
  db.createTag('g', { name: 'rax', content: 'x' });
  assert.deepStrictEqual(db.searchTags('g', 'r_'), ['r_x'], 'underscore is literal, not a LIKE wildcard');
  assert.ok(db.deleteTag('g', 'rax'));
  assert.ok(!db.deleteTag('g', 'rax'));
  for (let i = db.countTags('g'); i < 100; i++) assert.strictEqual(db.createTag('g', { name: `t${i}`, content: 'x' }), 'ok');
  assert.strictEqual(db.createTag('g', { name: 'onemore', content: 'x' }), 'cap');
  // guild_id column, so the retention purge covers tags
  const raw = new Database(':memory:');
  create(raw);
  assert.ok(raw.prepare('PRAGMA table_info("tags")').all().some((c) => c.name === 'guild_id'));
});

// ---------- command ----------

function world() {
  const roles = new Map([['900000000000000077', { id: '900000000000000077', name: 'Taggers', managed: false, toString: () => '<@&900000000000000077>' }]]);
  const channel = { id: '700000000000000001' };
  const guild = { id: G, name: 'Zion', memberCount: 42, roles: { cache: roles }, channels: { cache: new Map() } };
  const commands = new Map([['ban', {}], ['tag', tagCmd]]);
  const client = { user: { id: 'bot', displayAvatarURL: () => null }, commands, aliases: new Map([['b', {}]]), users: { cache: new Map() } };
  guild.client = client;
  const member = (id, perms = 0n, roleIds = []) => ({
    id, displayName: `Name${id}`, permissions: new PermissionsBitField(perms),
    roles: { cache: new Map(roleIds.map((r) => [r, roles.get(r)])) },
  });
  return { guild, channel, client, member };
}

function slash(w, member, sub, opts = {}) {
  const out = [];
  return {
    guild: w.guild, client: w.client, channel: w.channel, member, user: { id: member.id, username: `user${member.id}` },
    memberPermissions: member.permissions, out,
    options: {
      getSubcommand: () => sub,
      getString: (n) => opts[n] ?? null,
      getBoolean: (n) => opts[n] ?? null,
      getRole: (n) => opts[n] ?? null,
    },
    reply: async (p) => { out.push(p); },
  };
}

function prefix(w, member, content) {
  const out = [];
  const message = {
    content, guild: w.guild, guildId: w.guild.id, channel: w.channel, channelId: w.channel.id,
    author: { id: member.id, username: `user${member.id}` }, member, client: w.client,
    attachments: new Map(), createdTimestamp: Date.now(),
    reply: async (p) => { out.push(p); return { edit: async () => {}, delete: async () => {} }; },
  };
  const args = content.slice(1).trim().split(/\s+/);
  args.shift();
  const ctx = new PrefixContext(message, args, tagCmd);
  return { ctx, out };
}

const desc = (p) => p.embeds?.[0]?.toJSON?.().description ?? p.embeds?.[0]?.data?.description;

test('/tag create needs Manage Server or the tag manager role; names cannot shadow commands', async () => {
  const w = world();
  const pleb = w.member('11');
  let i = slash(w, pleb, 'create', { name: 'rules', content: 'x' });
  await tagCmd.execute(i);
  assert.match(desc(i.out[0]), /Manage Server/);

  const admin = w.member('12', F.ManageGuild);
  i = slash(w, admin, 'manager', { role: w.guild.roles.cache.get('900000000000000077') });
  await tagCmd.execute(i);
  assert.strictEqual(fakeStore.getConfig(G, 'tag_manager_role'), '900000000000000077');
  i = slash(w, pleb, 'manager', {});
  await tagCmd.execute(i);
  assert.match(desc(i.out[0]), /Manage Server/, 'only Manage Server picks the manager role');

  const tagger = w.member('13', 0n, ['900000000000000077']);
  i = slash(w, tagger, 'create', { name: 'Rules', content: 'Hi {user}!\\nBe nice @everyone' });
  await tagCmd.execute(i);
  assert.match(desc(i.out[0]), /created/);
  for (const name of ['ban', 'b', 'list', 'bad name']) {
    i = slash(w, admin, 'create', { name, content: 'x' });
    await tagCmd.execute(i);
    assert.doesNotMatch(desc(i.out[0]), /created/, name);
  }
});

test('/tag use: anyone, no pings ever, uses counted, 3s per-user cooldown', async () => {
  const w = world();
  const user = w.member('21');
  let i = slash(w, user, 'use', { name: 'rules' });
  await tagCmd.execute(i);
  assert.strictEqual(i.out[0].content, 'Hi <@21>!\nBe nice @everyone');
  assert.deepStrictEqual(i.out[0].allowedMentions, { parse: [], repliedUser: false });
  i = slash(w, user, 'use', { name: 'rules' });
  await tagCmd.execute(i);
  assert.match(desc(i.out[0]), /Wait/);
  assert.strictEqual(i.out[0].ephemeral, true);
  i = slash(w, w.member('22'), 'use', { name: 'nope' });
  await tagCmd.execute(i);
  assert.match(desc(i.out[0]), /No tag named/);
  i = slash(w, w.member('23'), 'info', { name: 'rules' });
  await tagCmd.execute(i);
  assert.match(desc(i.out[0]), /\*\*Uses\*\* 1/);
});

test('prefix: ;tag create keeps newlines and the embed flag, ;tag <name> args fills {args}', async () => {
  const w = world();
  const admin = w.member('31', F.ManageGuild);
  let { ctx, out } = prefix(w, admin, ';tag create echo --embed You said:\n{args}');
  await tagCmd.execute(ctx);
  assert.match(desc(out[0]), /created/);
  ({ ctx, out } = prefix(w, w.member('32'), ';tag echo hello <@&900000000000000077> world'));
  await tagCmd.execute(ctx);
  assert.strictEqual(desc(out[0]), 'You said:\nhello <@&900000000000000077> world');
  assert.deepStrictEqual(out[0].allowedMentions, { parse: [], repliedUser: false });
  ({ ctx, out } = prefix(w, w.member('33'), ';tag use echo hi'));
  await tagCmd.execute(ctx);
  assert.strictEqual(desc(out[0]), 'You said:\nhi');
  ({ ctx, out } = prefix(w, admin, ';tag edit echo plain now'));
  await tagCmd.execute(ctx);
  assert.match(desc(out[0]), /updated/);
  ({ ctx, out } = prefix(w, admin, ';tag list'));
  await tagCmd.execute(ctx);
  assert.match(desc(out[0]), /`echo` \(2\)/);
  ({ ctx, out } = prefix(w, admin, ';tag delete echo'));
  await tagCmd.execute(ctx);
  assert.match(desc(out[0]), /deleted/);
});

test('/tag builds a valid slash payload usable by everyone, with only top-level subcommands', () => {
  const json = tagCmd.data.toJSON();
  assert.ok(!json.default_member_permissions, 'everyone can use tags');
  assert.deepStrictEqual(json.options.map((o) => o.name), ['use', 'create', 'edit', 'delete', 'info', 'list', 'manager']);
  assert.ok(json.options.every((o) => o.type === 1));
});
