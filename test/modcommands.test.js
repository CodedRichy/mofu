// /case, /tempban, /warnconfig, /automod and the warn-threshold path, run against an in-memory store that is
// injected into the require cache, so data/sonder.db is never opened.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const Database = require('better-sqlite3');

const config = new Map();
const warnings = [];
const fakeStore = {
  db: new Database(':memory:'),
  getConfig: (g, k) => (config.has(`${g}:${k}`) ? JSON.parse(config.get(`${g}:${k}`)) : null),
  setConfig: (g, k, v) => { if (v === null || v === undefined) config.delete(`${g}:${k}`); else config.set(`${g}:${k}`, JSON.stringify(v)); },
  addWarning: (g, u, w) => { warnings.push({ g, u, ...w, timestamp: new Date().toISOString() }); return warnings.length; },
  getWarnings: (g, u) => warnings.filter((w) => w.g === g && w.u === u).map((w, i) => ({ id: i + 1, ...w, moderatorId: w.moderatorId })),
  clearWarnings: () => 0,
};
const storePath = require.resolve(path.join(__dirname, '..', 'src', 'database', 'store.js'));
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: fakeStore };

const PrefixContext = require('../src/utils/prefixContext');
const infractions = require('../src/database/infractions');
const caseCmd = require('../src/commands/moderation/case');
const tempban = require('../src/commands/moderation/tempban');
const warnconfig = require('../src/commands/config/warnconfig');
const automodCmd = require('../src/commands/config/automod');
const warn = require('../src/commands/moderation/warn');

const ALL = [caseCmd, tempban, warnconfig, automodCmd];

test('new commands build valid slash JSON within Discord limits', () => {
  for (const c of ALL) {
    const j = c.data.toJSON();
    assert.ok(/^[a-z]{1,32}$/.test(j.name), j.name);
    assert.ok(j.description.length <= 100, j.name);
    const walk = (opts = []) => {
      assert.ok(opts.length <= 25);
      opts.forEach((o) => {
        assert.ok(o.description.length >= 1 && o.description.length <= 100, `${j.name}.${o.name}: ${o.description.length}`);
        assert.ok(!o.choices || o.choices.length <= 25);
        if (o.options) walk(o.options);
      });
      // required options must come before optional ones (Discord rejects otherwise)
      const firstOpt = opts.findIndex((o) => o.type > 2 && !o.required);
      if (firstOpt >= 0) assert.ok(!opts.slice(firstOpt).some((o) => o.type > 2 && o.required), j.name);
    };
    walk(j.options);
  }
});

// --- fake Discord objects ---
function fakeGuild() {
  const sentLog = [];
  const g = {
    id: 'G1', name: 'Test', ownerId: '100000000000000001',
    channels: { cache: new Map() },
    roles: { cache: new Map() },
    members: {
      cache: new Map(),
      fetch: async () => { throw new Error('unknown'); },
      ban: async (id, o) => { sentLog.push(['ban', id, o.reason]); },
      me: { permissions: { has: () => true } },
    },
    client: null,
  };
  return { g, sentLog };
}
function ctxFor(cmd, argv, { guild, member, user }) {
  const replies = [];
  const message = {
    guild, guildId: guild.id, channel: {}, channelId: 'C', author: user, member, client: guild.client,
    attachments: new Map(), createdTimestamp: Date.now(),
    reply: async (d) => { replies.push(d); return { edit: async () => {}, delete: async () => {} }; },
  };
  const ctx = new PrefixContext(message, argv.slice(), cmd);
  return { ctx, replies };
}
function world() {
  const { g, sentLog } = fakeGuild();
  const users = new Map();
  const mk = (id, tag) => { const u = { id, tag, bot: false, displayAvatarURL: () => null, send: async () => {} }; users.set(id, u); return u; };
  const modUser = mk('200000000000000002', 'mod#1');
  const target = mk('300000000000000003', 'target#1');
  const client = { user: { id: '900000000000000009', tag: 'Sonder#1', displayAvatarURL: () => null }, users: { cache: users } };
  g.client = client;
  const perms = (all) => ({ has: () => all });
  const modMember = { id: modUser.id, user: modUser, permissions: perms(false), roles: { highest: { position: 10 } } };
  const calls = [];
  const targetMember = {
    id: target.id, user: target, roles: { highest: { position: 1 } }, manageable: true, moderatable: true, kickable: true, bannable: true,
    timeout: async (ms, r) => calls.push(['timeout', ms, r]), kick: async (r) => calls.push(['kick', r]),
  };
  g.members.cache.set(target.id, targetMember);
  return { g, sentLog, modUser, target, modMember, client, calls };
}
const text = (replies) => replies.map((r) => r.embeds?.[0]?.data?.description || r.content || '').join('\n');

test('case: view by number, prefix shorthand, reason edit capped and permission-checked', async () => {
  const w = world();
  const id = infractions.openCase({ guildId: 'G1', action: 'warn', targetId: w.target.id, targetTag: 'target#1', moderatorId: w.modUser.id, reason: 'first' });
  let { ctx, replies } = ctxFor(caseCmd, [String(id)], { guild: w.g, member: w.modMember, user: w.modUser });
  await caseCmd.execute(ctx);
  assert.match(text(replies), /first/);
  assert.match(replies[0].embeds[0].data.author.name, new RegExp(`Case #${id}`));

  ({ ctx, replies } = ctxFor(caseCmd, ['reason', String(id), 'better', 'reason'], { guild: w.g, member: w.modMember, user: w.modUser }));
  await caseCmd.execute(ctx);
  assert.strictEqual(infractions.getCase('G1', id).reason, 'better reason');

  // someone else without Manage Server cannot rewrite it
  const other = { id: '400000000000000004', tag: 'x#1' };
  ({ ctx, replies } = ctxFor(caseCmd, ['reason', String(id), 'hijack'], { guild: w.g, member: { ...w.modMember, id: other.id }, user: other }));
  await caseCmd.execute(ctx);
  assert.match(text(replies), /Only the moderator/);
  assert.strictEqual(infractions.getCase('G1', id).reason, 'better reason');

  ({ ctx, replies } = ctxFor(caseCmd, ['view', '99999'], { guild: w.g, member: w.modMember, user: w.modUser }));
  await caseCmd.execute(ctx);
  assert.match(text(replies), /does not exist/);

  ({ ctx } = ctxFor(caseCmd, ['reason', String(id), 'z'.repeat(600)], { guild: w.g, member: w.modMember, user: w.modUser }));
  assert.ok(ctx._invalid.length, 'prefix parser enforces the 512 cap');
});

test('tempban: validates duration, bans, schedules expiry, opens a tempban case', async () => {
  const w = world();
  let { ctx, replies } = ctxFor(tempban, [`<@${w.target.id}>`, 'forever', 'x'], { guild: w.g, member: w.modMember, user: w.modUser });
  await tempban.execute(ctx);
  assert.match(text(replies), /Invalid duration/);

  ({ ctx, replies } = ctxFor(tempban, [`<@${w.target.id}>`, '400d'], { guild: w.g, member: w.modMember, user: w.modUser }));
  await tempban.execute(ctx);
  assert.match(text(replies), /365 days/);

  ({ ctx, replies } = ctxFor(tempban, [`<@${w.target.id}>`, '2d', 'raid', 'spam'], { guild: w.g, member: w.modMember, user: w.modUser }));
  const before = Date.now();
  await tempban.execute(ctx);
  assert.strictEqual(w.sentLog[0][0], 'ban');
  const row = infractions.getTempban('G1', w.target.id);
  assert.ok(row && row.expires_at >= before + 2 * 86400000 - 1000);
  assert.strictEqual(infractions.getCase('G1', row.case_id).action, 'tempban');
  assert.strictEqual(infractions.getCase('G1', row.case_id).reason, 'raid spam');
});

test('tempban refuses the owner and members above the moderator', async () => {
  const w = world();
  w.target.id = w.g.ownerId; // pretend the target is the owner
  w.client.users.cache.set(w.g.ownerId, w.target);
  let { ctx, replies } = ctxFor(tempban, [`<@${w.g.ownerId}>`, '1d'], { guild: w.g, member: w.modMember, user: w.modUser });
  await tempban.execute(ctx);
  assert.match(text(replies), /owner/);

  const w2 = world();
  w2.g.members.cache.get(w2.target.id).roles.highest.position = 50;
  ({ ctx, replies } = ctxFor(tempban, [`<@${w2.target.id}>`, '1d'], { guild: w2.g, member: w2.modMember, user: w2.modUser }));
  await tempban.execute(ctx);
  assert.match(text(replies), /higher or equal role/);
  assert.strictEqual(w2.sentLog.length, 0);
});

test('warnconfig add/list/remove/expiry round-trip through config', async () => {
  const w = world();
  const run = async (argv) => { const { ctx, replies } = ctxFor(warnconfig, argv, { guild: w.g, member: w.modMember, user: w.modUser }); await warnconfig.execute(ctx); return text(replies); };
  assert.match(await run(['add', '3', 'mute', '30m']), /mute 30m/);
  assert.match(await run(['add', '5', 'ban', '7d']), /ban 7d/);
  assert.match(await run(['add', '4', 'kick', '1h']), /Only mute and ban/);
  assert.match(await run(['add', '6', 'explode']), /must be one of/i);
  assert.match(await run(['expiry', '30']), /30/);
  assert.deepStrictEqual(fakeStore.getConfig('G1', 'warn_thresholds').map((t) => t.count), [3, 5]);
  assert.strictEqual(fakeStore.getConfig('G1', 'warn_expiry_days'), 30);
  assert.match(await run(['remove', '9']), /no threshold/);
  assert.match(await run(['remove', '5']), /Removed/);
  await run(['expiry', '0']);
  assert.strictEqual(fakeStore.getConfig('G1', 'warn_expiry_days'), null);
});

test('warn add applies the threshold reached, with an Auto reason case', async () => {
  const w = world();
  fakeStore.setConfig('G1', 'warn_thresholds', [{ count: 2, action: 'mute', durationMs: 600000 }]);
  const run = async () => {
    const { ctx, replies } = ctxFor(warn, ['add', `<@${w.target.id}>`, 'being', 'rude'], { guild: w.g, member: w.modMember, user: w.modUser });
    await warn.execute(ctx);
    return text(replies);
  };
  const t1 = await run();
  assert.doesNotMatch(t1, /Threshold/);
  assert.strictEqual(w.calls.length, 0);
  const t2 = await run();
  assert.match(t2, /Threshold reached \(2\): mute 10m/);
  assert.deepStrictEqual(w.calls[0], ['timeout', 600000, 'Auto: 2 warnings']);
  fakeStore.setConfig('G1', 'warn_thresholds', null);
});

test('automod rule/status store a normalized ladder', async () => {
  const w = world();
  const run = async (argv) => { const { ctx, replies } = ctxFor(automodCmd, argv, { guild: w.g, member: w.modMember, user: w.modUser }); await automodCmd.execute(ctx); return text(replies); };
  assert.match(await run(['rule', 'links', 'ban', '15', '30']), /warn -> timeout 15m -> ban \(window 30m\)/);
  assert.deepStrictEqual(fakeStore.getConfig('G1', 'automod_rules').links, { action: 'ban', timeoutMin: 15, windowMin: 30 });
  assert.match(await run(['status']), /links\*\*: warn -> timeout 15m -> ban/);
  await run(['rule', 'links', 'off']);
  assert.strictEqual(fakeStore.getConfig('G1', 'automod_rules'), null);
  const { ctx } = ctxFor(automodCmd, ['rule', 'nothing', 'ban'], { guild: w.g, member: w.modMember, user: w.modUser });
  assert.ok(ctx._invalid.length, 'unknown trigger rejected by the choice list');
});

test('automod ladder end to end with fake message: warn, then timeout, then kick', async () => {
  const automod = require('../src/utils/automod');
  const r = require('../src/utils/automodRules');
  const w = world();
  const counter = new r.StrikeCounter();
  const opened = [];
  const modlog = { openCase: (g, c) => { opened.push(c); return opened.length; }, voidCase() {}, send: async () => 1 };
  const msg = {
    guild: w.g, member: w.g.members.cache.get(w.target.id), author: w.target, client: w.client, id: 'm1',
    channel: { send: async () => ({ delete: async () => {} }) },
  };
  const rule = { action: 'kick', timeoutMin: 5, windowMin: 60 };
  const kinds = [];
  for (let i = 0; i < 3; i++) kinds.push((await automod.punish(msg, 'links', rule, { store: fakeStore, modlog, strikes: counter })).kind);
  assert.deepStrictEqual(kinds, ['warn', 'timeout', 'kick']);
  assert.deepStrictEqual(w.calls.map((c) => c[0]), ['timeout', 'kick']);
  assert.strictEqual(w.calls[0][1], 300000);
  assert.strictEqual(counter.size, 0, 'kick resets the strike count');
  assert.deepStrictEqual(opened.map((c) => c.action), ['warn', 'mute', 'kick']);
});

test('checkContent: new triggers only fire with a rule; links and words keep their old switches', () => {
  const automod = require('../src/utils/automod');
  const G = 'G-check';
  assert.strictEqual(automod.checkContent(G, 'WHY IS NOBODY ANSWERING ME'), null);
  assert.strictEqual(automod.checkContent(G, 'discord.gg/abc'), null);
  fakeStore.setConfig(G, 'automod_rules', { caps: { action: 'warn' }, invites: { action: 'timeout' } });
  assert.strictEqual(automod.checkContent(G, 'WHY IS NOBODY ANSWERING ME').trigger, 'caps');
  assert.strictEqual(automod.checkContent(G, 'join discord.gg/abc').trigger, 'invites');
  assert.strictEqual(automod.checkContent(G, 'see https://example.com'), null);
  fakeStore.setConfig(G, 'antilink', true);
  const hit = automod.checkContent(G, 'see https://example.com');
  assert.deepStrictEqual([hit.type, hit.trigger], ['antilink', 'links']);
  fakeStore.setConfig(G, 'word_filter', ['badword']);
  assert.strictEqual(automod.checkContent(G, 'a BadWord here').trigger, 'badwords');
  assert.strictEqual(automod.spamRule(G), null);
});

test('punish normalizes a bare rule so strikes still accumulate (regression: NaN window)', async () => {
  const automod = require('../src/utils/automod');
  const r = require('../src/utils/automodRules');
  const w = world();
  const msg = { guild: w.g, member: w.g.members.cache.get(w.target.id), author: w.target, client: w.client, id: 'm3', channel: { send: async () => ({ delete: async () => {} }) } };
  const counter = new r.StrikeCounter();
  const modlog = { openCase: () => 1, voidCase() {}, send: async () => 1 };
  const kinds = [];
  for (let i = 0; i < 3; i++) kinds.push((await automod.punish(msg, 'spam', { action: 'timeout' }, { store: fakeStore, modlog, strikes: counter })).kind);
  assert.deepStrictEqual(kinds, ['warn', 'timeout', 'timeout']);
  assert.strictEqual(await automod.punish(msg, 'spam', { action: 'off' }, { store: fakeStore, modlog, strikes: counter }), null);
});

test('automod ladder falls back when the bot cannot act', async () => {
  const automod = require('../src/utils/automod');
  const r = require('../src/utils/automodRules');
  const w = world();
  const m = w.g.members.cache.get(w.target.id);
  m.bannable = false; m.kickable = false; m.moderatable = false;
  const msg = { guild: w.g, member: m, author: w.target, client: w.client, id: 'm2', channel: { send: async () => ({ delete: async () => {} }) } };
  const counter = new r.StrikeCounter();
  const modlog = { openCase: () => 1, voidCase() {}, send: async () => 1 };
  const kinds = [];
  for (let i = 0; i < 3; i++) kinds.push((await automod.punish(msg, 'caps', { action: 'ban' }, { store: fakeStore, modlog, strikes: counter })).kind);
  assert.deepStrictEqual(kinds, ['warn', 'warn', 'warn']);
  assert.strictEqual(w.calls.length, 0);
});
