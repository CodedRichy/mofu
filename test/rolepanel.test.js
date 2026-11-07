// Role panels: pure rules, the database layer, /reactionrole and the click / select / reaction handlers.
// The config store is replaced in the require cache with an in-memory database, so data/sonder.db is never opened.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const Database = require('better-sqlite3');
const { PermissionsBitField, ComponentType } = require('discord.js');

const config = new Map();
const fakeStore = {
  db: new Database(':memory:'),
  getConfig: (g, k) => (config.has(`${g}:${k}`) ? JSON.parse(config.get(`${g}:${k}`)) : null),
  setConfig: (g, k, v) => { if (v === null || v === undefined) config.delete(`${g}:${k}`); else config.set(`${g}:${k}`, JSON.stringify(v)); },
};
const storePath = require.resolve(path.join(__dirname, '..', 'src', 'database', 'store.js'));
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: fakeStore };

const rp = require('../src/utils/rolepanel');
const { create } = require('../src/database/rolepanels');
const panelsDb = require('../src/database/rolepanels');
const runtime = require('../src/handlers/rolepanel');
const cmd = require('../src/commands/config/reactionrole');
const { roleProblem } = require('../src/utils/modguard');

const F = PermissionsBitField.Flags;
const G = '900000000000000001';
const SF = (n) => `90000000000000${String(n).padStart(4, '0')}`;

// ---------- pure rules ----------

test('planPick: normal toggles, unique swaps, verify adds only, drop removes only', () => {
  const ids = ['a', 'b', 'c'];
  assert.deepStrictEqual(rp.planPick('normal', new Set(['a']), ids, ['a', 'b']), { add: ['b'], remove: ['a'], already: [], missing: [] });
  assert.deepStrictEqual(rp.planPick('unique', new Set(['a', 'c']), ids, ['b']), { add: ['b'], remove: ['a', 'c'], already: [], missing: [] });
  assert.deepStrictEqual(rp.planPick('unique', new Set(['b']), ids, ['b']), { add: [], remove: ['b'], already: [], missing: [] });
  assert.deepStrictEqual(rp.planPick('verify', new Set(['a']), ids, ['a', 'b']), { add: ['b'], remove: [], already: ['a'], missing: [] });
  assert.deepStrictEqual(rp.planPick('drop', new Set(['a']), ids, ['a', 'b']), { add: [], remove: ['a'], already: [], missing: ['b'] });
  // roles not on the panel are ignored, whatever the client sends
  assert.deepStrictEqual(rp.planPick('normal', new Set(), ids, ['zzz']).add, []);
});

test('planReaction: reactions are state, not toggles', () => {
  const ids = ['a', 'b'];
  assert.deepStrictEqual(rp.planReaction('normal', new Set(), ids, 'a', true).add, ['a']);
  assert.deepStrictEqual(rp.planReaction('normal', new Set(['a']), ids, 'a', false).remove, ['a']);
  assert.deepStrictEqual(rp.planReaction('unique', new Set(['b']), ids, 'a', true), { add: ['a'], remove: ['b'], already: [], missing: [] });
  assert.deepStrictEqual(rp.planReaction('verify', new Set(['a']), ids, 'a', false).remove, []);
  assert.deepStrictEqual(rp.planReaction('drop', new Set(['a']), ids, 'a', true).remove, ['a']);
  assert.deepStrictEqual(rp.planReaction('drop', new Set(), ids, 'a', true).add, []);
});

test('parseEmoji accepts unicode and known custom emoji, rejects text and foreign emoji', () => {
  const client = { emojis: { cache: new Map([[SF(1), {}]]) } };
  assert.strictEqual(rp.parseEmoji('\u{1F534}').key, '\u{1F534}');
  assert.strictEqual(rp.parseEmoji('❤️').key, '❤'); // variation selector stripped for matching
  assert.ok(rp.parseEmoji('1️⃣').emoji);
  assert.deepStrictEqual(rp.parseEmoji(`<a:party:${SF(1)}>`, { client }).emoji, { id: SF(1), name: 'party', animated: true });
  assert.ok(rp.parseEmoji(`<:other:${SF(2)}>`, { client }).error);
  for (const bad of ['red', 'abc\u{1F534}', '', ':smile:', '\u{1F534} \u{1F535}']) assert.ok(rp.parseEmoji(bad).error, bad);
});

function role(id, extra = {}) {
  return { id, name: `role-${id.slice(-3)}`, position: 5, managed: false, editable: true, permissions: new PermissionsBitField(0n), toString: () => `<@&${id}>`, ...extra };
}

test('createCheck: hierarchy via roleProblem, dangerous roles need allow_dangerous from an admin', () => {
  const guild = { id: G, ownerId: 'owner' };
  const mod = { id: 'mod', roles: { highest: { position: 10 } }, permissions: new PermissionsBitField(F.ManageRoles) };
  const admin = { id: 'adm', roles: { highest: { position: 10 } }, permissions: new PermissionsBitField(F.Administrator) };
  const plain = role(SF(10));
  const staff = role(SF(11), { permissions: new PermissionsBitField(F.BanMembers | F.SendMessages) });
  assert.deepStrictEqual(rp.createCheck(guild, mod, plain, { roleProblem }), { dangerOk: null });
  assert.match(rp.createCheck(guild, mod, role(G), { roleProblem }).error, /everyone/);
  assert.match(rp.createCheck(guild, mod, role(SF(12), { managed: true }), { roleProblem }).error, /integration/);
  assert.match(rp.createCheck(guild, mod, role(SF(13), { position: 20 }), { roleProblem }).error, /above your highest/);
  assert.match(rp.createCheck(guild, mod, role(SF(14), { editable: false }), { roleProblem }).error, /can't manage/);
  assert.match(rp.createCheck(guild, mod, staff, { roleProblem }).error, /Ban Members.*allow_dangerous/);
  assert.match(rp.createCheck(guild, mod, staff, { roleProblem, allowDangerous: true }).error, /Only an administrator/);
  assert.strictEqual(rp.createCheck(guild, admin, staff, { roleProblem, allowDangerous: true }).dangerOk, String(F.BanMembers));
});

test('grantProblem re-checks at grant time, including permissions gained after confirmation', () => {
  const guild = { id: G };
  assert.match(rp.grantProblem(guild, undefined, null), /deleted/);
  assert.match(rp.grantProblem(guild, role(G), null), /everyone/);
  assert.match(rp.grantProblem(guild, role(SF(31), { editable: false }), null), /my highest role/);
  const r = role(SF(2), { permissions: new PermissionsBitField(F.BanMembers) });
  assert.strictEqual(rp.grantProblem(guild, r, { danger_ok: String(F.BanMembers) }), null);
  r.permissions = new PermissionsBitField(F.BanMembers | F.Administrator);
  assert.match(rp.grantProblem(guild, r, { danger_ok: String(F.BanMembers) }), /Administrator/);
  // removing a staff role from yourself is always allowed
  assert.strictEqual(rp.grantProblem(guild, r, null, { adding: false }), null);
});

test('render: 25 buttons in 5 rows of 5, select limits, embed within Discord limits', () => {
  const entries = Array.from({ length: 25 }, (_, i) => ({ role_id: SF(100 + i), label: 'L'.repeat(80), emoji: null, description: null }));
  const panel = { panel_id: 7, type: 'button', mode: 'normal', title: 'T'.repeat(400), description: 'D'.repeat(1000) };
  const out = rp.render(panel, entries).components.map((c) => c.toJSON());
  assert.strictEqual(out.length, 5);
  assert.ok(out.every((row) => row.components.length === 5));
  assert.strictEqual(out[0].components[0].custom_id, `rp:7:${SF(100)}`);
  assert.ok(out.flatMap((r) => r.components).every((b) => b.custom_id.length <= 100 && b.label.length <= 80));
  const embed = rp.render(panel, entries).embeds[0].toJSON();
  assert.ok(embed.title.length <= 256);
  assert.ok(embed.description.length <= 4096, `description ${embed.description.length}`);
  assert.match(embed.description, /Click a button/);

  const sel = rp.render({ ...panel, type: 'select', mode: 'unique' }, entries).components[0].toJSON().components[0];
  assert.strictEqual(sel.type, ComponentType.StringSelect);
  assert.strictEqual(sel.custom_id, 'rp:7');
  assert.strictEqual(sel.max_values, 1);
  assert.strictEqual(sel.options.length, 25);
  assert.strictEqual(rp.render({ ...panel, type: 'select' }, entries.slice(0, 3)).components[0].toJSON().components[0].max_values, 3);
  assert.deepStrictEqual(rp.render({ ...panel, type: 'reaction' }, entries.slice(0, 3)).components, []);
});

// ---------- database ----------

test('db: per-guild panel numbers, entries keep order, upsert, remove, lookup by message, delete', () => {
  const db = create(new Database(':memory:'));
  const a = db.createPanel({ guildId: 'g1', title: 'A', entries: [{ roleId: 'r1' }, { roleId: 'r2', label: 'two' }] });
  const b = db.createPanel({ guildId: 'g1', title: 'B' });
  assert.deepStrictEqual([a, b, db.createPanel({ guildId: 'g2', title: 'C' })], [1, 2, 1]);
  assert.deepStrictEqual(db.getPanel('g1', a).entries.map((e) => e.role_id), ['r1', 'r2']);
  assert.strictEqual(db.upsertEntry('g1', a, { roleId: 'r3', emoji: { name: 'x' }, emojiKey: 'x' }), 'added');
  assert.strictEqual(db.upsertEntry('g1', a, { roleId: 'r1', label: 'one' }), 'updated');
  const p = db.getPanel('g1', a);
  assert.deepStrictEqual(p.entries.map((e) => [e.role_id, e.label]), [['r1', 'one'], ['r2', 'two'], ['r3', null]]);
  assert.ok(db.removeEntry('g1', a, 'r2'));
  assert.ok(!db.removeEntry('g1', a, 'r2'));
  db.setMessage('g1', a, 'c1', 'm1');
  assert.strictEqual(db.panelByMessage('m1').panel_id, a);
  assert.ok(db.updatePanel('g1', a, { mode: 'unique', bogus: 'ignored' }));
  assert.strictEqual(db.getPanel('g1', a).mode, 'unique');
  assert.strictEqual(db.countPanels('g1'), 2);
  assert.ok(db.deletePanel('g1', a));
  assert.strictEqual(db.getPanel('g1', a), null);
  assert.strictEqual(db.panelByMessage('m1'), null);
});

test('db: both tables carry guild_id so the retention purge covers them', () => {
  const raw = new Database(':memory:');
  create(raw);
  for (const t of ['role_panels', 'role_panel_entries']) {
    assert.ok(raw.prepare(`PRAGMA table_info("${t}")`).all().some((c) => c.name === 'guild_id'), t);
  }
});

// ---------- fake Discord world for the command + handlers ----------

let nextMsg = 1;
function world() {
  const roles = new Map();
  const add = (r) => { roles.set(r.id, r); return r; };
  add(role(G, { position: 0, name: '@everyone' }));
  const red = add(role(SF(201), { name: 'Red' }));
  const blue = add(role(SF(202), { name: 'Blue' }));
  const green = add(role(SF(203), { name: 'Green' }));
  const staff = add(role(SF(204), { name: 'Mods', permissions: new PermissionsBitField(F.KickMembers) }));
  const high = add(role(SF(205), { name: 'High', position: 50 }));

  const messages = new Map();
  // message ids are unique across worlds, like real snowflakes
  const makeMessage = (payload) => {
    const id = SF(5000 + nextMsg++);
    const m = {
      id, channelId: SF(300), payload, reactions: { cache: new Map() }, reacted: [],
      edit: async (p) => { m.payload = { ...m.payload, ...p }; return m; },
      delete: async () => { messages.delete(id); },
      react: async (e) => { m.reacted.push(e); },
    };
    messages.set(id, m);
    return m;
  };
  const channel = {
    id: SF(300), toString: () => `<#${SF(300)}>`,
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    send: async (p) => makeMessage(p),
    messages: { fetch: async (id) => { if (!messages.has(id)) throw new Error('Unknown Message'); return messages.get(id); } },
  };
  const members = new Map();
  const guild = {
    id: G, ownerId: 'owner', name: 'Srv',
    roles: { cache: roles },
    channels: { cache: new Map([[channel.id, channel]]) },
    members: { me: { id: 'bot' }, cache: members, fetch: async (id) => members.get(id) },
  };
  const client = { user: { id: 'bot', displayAvatarURL: () => null }, emojis: { cache: new Map() } };
  guild.client = client;
  const member = (id, perms, held = []) => {
    const cache = new Map(held.map((r) => [r, roles.get(r)]));
    const m = {
      id, permissions: new PermissionsBitField(perms),
      roles: {
        cache, highest: { position: 10 },
        add: async (r) => { cache.set(r, roles.get(r)); },
        remove: async (r) => { cache.delete(r); },
      },
    };
    members.set(id, m);
    return m;
  };
  return { guild, client, channel, messages, member, red, blue, green, staff, high };
}

// Minimal slash-style interaction for a subcommand.
function slash(w, invoker, sub, opts = {}) {
  const out = [];
  const i = {
    guild: w.guild, client: w.client, channel: w.channel, member: invoker, user: { id: invoker.id },
    replied: false, deferred: false, out,
    options: {
      getSubcommand: () => sub,
      getString: (n) => opts[n] ?? null,
      getInteger: (n) => opts[n] ?? null,
      getBoolean: (n) => opts[n] ?? null,
      getRole: (n) => opts[n] ?? null,
      getChannel: (n) => opts[n] ?? null,
    },
    reply: async (p) => { i.replied = true; out.push(p); },
    deferReply: async () => { i.deferred = true; },
    editReply: async (p) => { out.push(p); },
  };
  return i;
}
const text = (i) => i.out.map((p) => p.embeds?.[0]?.toJSON?.().description || p.embeds?.[0]?.data?.description || p.content || '').join('\n');

test('/reactionrole create posts a DB-backed button panel; hierarchy and staff roles are refused', async () => {
  const w = world();
  const mod = w.member('mod', F.ManageRoles);
  let i = slash(w, mod, 'create', { title: 'Colors', role1: w.red, label1: 'Red', role2: w.blue, emoji2: '\u{1F535}' });
  await cmd.execute(i);
  assert.match(text(i), /Panel #1 posted/);
  const panel = panelsDb.getPanel(G, 1);
  assert.strictEqual(panel.entries.length, 2);
  const msg = w.messages.get(panel.message_id);
  const ids = msg.payload.components.flatMap((r) => r.toJSON().components.map((c) => c.custom_id));
  assert.deepStrictEqual(ids, [`rp:1:${w.red.id}`, `rp:1:${w.blue.id}`]);

  i = slash(w, mod, 'create', { title: 'X', role1: w.high });
  await cmd.execute(i);
  assert.match(text(i), /above your highest role/);
  i = slash(w, mod, 'create', { title: 'X', role1: w.staff });
  await cmd.execute(i);
  assert.match(text(i), /staff permissions/);
  i = slash(w, mod, 'create', { title: 'X', role1: w.red, type: 'reaction' });
  await cmd.execute(i);
  assert.match(text(i), /need an emoji/);
  assert.strictEqual(panelsDb.countPanels(G), 1, 'refused panels leave no rows behind');
});

test('/reactionrole add, remove, edit update the stored panel and redraw the message', async () => {
  const w = world();
  const mod = w.member('mod', F.ManageRoles);
  const admin = w.member('adm', F.Administrator);
  await cmd.execute(slash(w, mod, 'create', { title: 'Colors', role1: w.red }));
  const id = panelsDb.listPanels(G).at(-1).panel_id;

  let i = slash(w, mod, 'add', { panel: id, role: w.green, label: 'Green!' });
  await cmd.execute(i);
  assert.match(text(i), /Added/);
  i = slash(w, mod, 'add', { panel: id, role: w.staff, allow_dangerous: true });
  await cmd.execute(i);
  assert.match(text(i), /Only an administrator/);
  i = slash(w, admin, 'add', { panel: id, role: w.staff, allow_dangerous: true });
  await cmd.execute(i);
  assert.match(text(i), /Added/);
  i = slash(w, mod, 'remove', { panel: id, role: w.green });
  await cmd.execute(i);
  assert.match(text(i), /Removed/);
  i = slash(w, mod, 'edit', { panel: id, mode: 'unique', type: 'select', title: 'Pick one' });
  await cmd.execute(i);
  assert.match(text(i), /updated/);
  const p = panelsDb.getPanel(G, id);
  assert.deepStrictEqual([p.mode, p.type, p.title, p.entries.length], ['unique', 'select', 'Pick one', 2]);
  const menu = w.messages.get(p.message_id).payload.components[0].toJSON().components[0];
  assert.strictEqual(menu.custom_id, `rp:${id}`);
  assert.strictEqual(menu.max_values, 1);
  i = slash(w, mod, 'edit', { panel: id, type: 'reaction' });
  await cmd.execute(i);
  assert.match(text(i), /cannot switch/);

  // message deleted by someone: refresh reposts and stores the new id
  w.messages.delete(p.message_id);
  i = slash(w, mod, 'refresh', { panel: id });
  await cmd.execute(i);
  assert.match(text(i), /posted it again/);
  assert.notStrictEqual(panelsDb.getPanel(G, id).message_id, p.message_id);

  i = slash(w, mod, 'delete', { panel: id });
  await cmd.execute(i);
  assert.match(text(i), /deleted/);
  assert.strictEqual(panelsDb.getPanel(G, id), null);
});

function click(w, member, customId, messageId, values) {
  const out = [];
  return {
    guild: w.guild, client: w.client, member, user: { id: member.id }, customId, values,
    message: { id: messageId }, out, deferred: false, replied: false,
    deferReply: async function () { this.deferred = true; },
    editReply: async (p) => { out.push(p); },
    reply: async (p) => { out.push(p); },
  };
}

test('buttons: unique mode swaps roles, replies are ephemeral confirmations, stale copies are refused', async () => {
  const w = world();
  const mod = w.member('mod', F.ManageRoles);
  await cmd.execute(slash(w, mod, 'create', { title: 'One', role1: w.red, role2: w.blue, mode: 'unique' }));
  const p = panelsDb.listPanels(G).at(-1);
  const user = w.member('u1', 0n, [w.red.id]);

  let c = click(w, user, `rp:${p.panel_id}:${w.blue.id}`, p.message_id);
  await runtime.handleButton(c);
  assert.ok(c.deferred);
  assert.ok(user.roles.cache.has(w.blue.id) && !user.roles.cache.has(w.red.id));
  assert.match(text(c), /Added \*\*Blue\*\*.*\n?Removed \*\*Red\*\*/s);

  c = click(w, user, `rp:${p.panel_id}:${w.blue.id}`, p.message_id);
  await runtime.handleButton(c);
  assert.match(text(c), /Removed \*\*Blue\*\*/);

  c = click(w, user, `rp:${p.panel_id}:${w.blue.id}`, SF(9999));
  await runtime.handleButton(c);
  assert.match(text(c), /old copy/);

  c = click(w, user, `rp:999:${w.blue.id}`, p.message_id);
  await runtime.handleButton(c);
  assert.match(text(c), /deleted/);
});

test('grant time: a role that moved above the bot or gained staff perms is not handed out', async () => {
  const w = world();
  const mod = w.member('mod', F.ManageRoles);
  await cmd.execute(slash(w, mod, 'create', { title: 'Two', role1: w.red, role2: w.green, mode: 'verify' }));
  const p = panelsDb.listPanels(G).at(-1);
  const user = w.member('u2', 0n);
  w.red.editable = false;
  let c = click(w, user, `rp:${p.panel_id}:${w.red.id}`, p.message_id);
  await runtime.handleButton(c);
  assert.match(text(c), /my highest role/);
  assert.ok(!user.roles.cache.has(w.red.id));
  w.green.permissions = new PermissionsBitField(F.Administrator);
  c = click(w, user, `rp:${p.panel_id}:${w.green.id}`, p.message_id);
  await runtime.handleButton(c);
  assert.match(text(c), /stopped handing it out/);
  assert.ok(!user.roles.cache.has(w.green.id));
});

test('select menus: normal mode toggles each pick; verify mode never removes', async () => {
  const w = world();
  const mod = w.member('mod', F.ManageRoles);
  await cmd.execute(slash(w, mod, 'create', { title: 'Sel', role1: w.red, role2: w.blue, type: 'select' }));
  const p = panelsDb.listPanels(G).at(-1);
  const user = w.member('u3', 0n, [w.red.id]);
  const c = click(w, user, `rp:${p.panel_id}`, p.message_id, [w.red.id, w.blue.id]);
  await runtime.handleSelect(c);
  assert.ok(user.roles.cache.has(w.blue.id) && !user.roles.cache.has(w.red.id));
  assert.match(text(c), /Added \*\*Blue\*\*/);
});

test('legacy rr_ buttons still toggle but never grant a role with staff permissions', async () => {
  const w = world();
  const user = w.member('u4', 0n);
  let c = click(w, user, `rr_${w.red.id}`, 'm');
  await runtime.handleLegacyButton(c);
  assert.ok(user.roles.cache.has(w.red.id));
  assert.match(text(c), /Added \*\*Red\*\*/);
  c = click(w, user, `rr_${w.staff.id}`, 'm');
  await runtime.handleLegacyButton(c);
  assert.ok(!user.roles.cache.has(w.staff.id));
  assert.match(text(c), /staff permissions/);
});

test('emoji reaction panels: react adds, unreact removes (normal), other messages are ignored', async () => {
  const w = world();
  const mod = w.member('mod', F.ManageRoles);
  await cmd.execute(slash(w, mod, 'create', { title: 'React', role1: w.red, emoji1: '\u{1F534}', role2: w.blue, emoji2: '\u{1F535}', type: 'reaction' }));
  const p = panelsDb.listPanels(G).at(-1);
  assert.deepStrictEqual(w.messages.get(p.message_id).reacted, ['\u{1F534}', '\u{1F535}']);
  const user = w.member('u5', 0n);
  const reaction = (emoji, messageId = p.message_id) => ({
    emoji: { name: emoji, id: null }, users: { remove: async () => {} },
    message: { id: messageId, guild: w.guild, reactions: { cache: new Map() } },
  });
  assert.strictEqual(await runtime.handleReaction(reaction('\u{1F534}'), { id: 'u5' }, true), true);
  assert.ok(user.roles.cache.has(w.red.id));
  await runtime.handleReaction(reaction('\u{1F534}'), { id: 'u5' }, false);
  assert.ok(!user.roles.cache.has(w.red.id));
  assert.strictEqual(await runtime.handleReaction(reaction('\u{1F534}', SF(4242)), { id: 'u5' }, true), false);
  assert.strictEqual(await runtime.handleReaction(reaction('\u{1F534}'), { id: 'bot', bot: true }, true), false);
});

test('reactionrole builds a valid slash payload with only top-level subcommands', () => {
  const json = cmd.data.toJSON();
  const subs = json.options.map((o) => o.name);
  assert.deepStrictEqual(subs, ['create', 'add', 'remove', 'edit', 'refresh', 'delete', 'list']);
  for (const s of json.options) {
    assert.strictEqual(s.type, 1);
    assert.ok((s.options || []).length <= 25);
  }
  assert.ok(json.default_member_permissions, 'staff only');
});
