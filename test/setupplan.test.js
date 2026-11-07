// AI setup plans (src/ai/setupplan.js): validation, sanitising, permission mapping, apply ordering. Pure logic, no network.
const test = require('node:test');
const assert = require('node:assert');
const sp = require('../src/ai/setupplan');

const perms = (...flags) => ({ has: (f) => flags.includes('Administrator') || flags.includes(f), top: 10 });
function mkState(over = {}) {
  return {
    ownerId: 'owner',
    invoker: { id: 'u1', ...perms('ManageGuild', 'ManageChannels', 'ManageRoles'), top: 10 },
    bot: { ...perms('ManageChannels', 'ManageRoles'), top: 20 },
    channels: [
      { id: '111111111111111111', name: 'general', type: 'text', parentId: null },
      { id: '111111111111111112', name: 'Info', type: 'category', parentId: null },
    ],
    roles: [
      { id: '222222222222222220', name: '@everyone', position: 0, managed: false, everyone: true },
      { id: '222222222222222221', name: 'Mods', position: 5, managed: false, everyone: false },
      { id: '222222222222222222', name: 'Boss', position: 15, managed: false, everyone: false },
      { id: '222222222222222223', name: 'Botrole', position: 3, managed: true, everyone: false },
    ],
    ...over,
  };
}

test('sanitizeName: text channel form, mentions refused, limits', () => {
  assert.strictEqual(sp.sanitizeName('Support Tickets!', 'text').name, 'support-tickets');
  assert.strictEqual(sp.sanitizeName('#welcome', 'text').name, 'welcome');
  assert.ok(sp.sanitizeName('hi @everyone', 'text').error);
  assert.ok(sp.sanitizeName('@here', 'free').error);
  assert.ok(sp.sanitizeName('<@123456789012345678>', 'free').error);
  assert.ok(sp.sanitizeName('everyone', 'free').error);
  assert.ok(sp.sanitizeName('   ', 'free').error);
  assert.ok(sp.sanitizeName(42, 'free').error);
  assert.strictEqual(sp.sanitizeName('a'.repeat(300), 'free').name.length, 100);
  assert.strictEqual(sp.sanitizeName('Voice `Room`​', 'free').name, 'Voice Room');
  assert.strictEqual(sp.sanitizeColor('#FF0000'), 0xff0000);
  assert.strictEqual(sp.sanitizeColor('red'), null);
  assert.ok(!sp.sanitizeTopic('hello @everyone <@1>').includes('@'));
});

test('parsePlanText fails closed', () => {
  assert.strictEqual(sp.parsePlanText(null), null);
  assert.strictEqual(sp.parsePlanText('sure thing!'), null);
  assert.strictEqual(sp.parsePlanText('{"ops": "no"}'), null);
  assert.strictEqual(sp.parsePlanText('{bad json}'), null);
  assert.deepStrictEqual(sp.parsePlanText('```json\n{"ops":[{"op":"create_category","name":"x"}]}\n```'), [{ op: 'create_category', name: 'x' }]);
});

test('closed op set: unknown, deleting and permission ops are dropped and reported', () => {
  const r = sp.validatePlan([
    { op: 'delete_channel', channel: 'general' },
    { op: 'set_permissions', channel: 'general' },
    { op: 'create_role', name: 'Admin', permissions: ['Administrator'], color: '#00ff00' },
    'junk',
    { op: 'create_category', name: 'Fun' },
  ], mkState());
  assert.deepStrictEqual(r.ops.map((o) => o.op), ['create_category', 'create_role']);
  assert.ok(r.dropped.some((d) => /delete_channel/.test(d.text)));
  assert.ok(r.dropped.some((d) => /set_permissions/.test(d.text)));
  assert.ok(r.dropped.some((d) => /unknown fields/.test(d.reason)));
  const role = r.ops.find((o) => o.op === 'create_role');
  assert.strictEqual(role.permissions, undefined);
});

test('max 12 ops, creates win over config', () => {
  const raw = [];
  for (let i = 0; i < 20; i++) raw.push({ op: 'create_text_channel', name: `chan${i}` });
  const r = sp.validatePlan(raw, mkState());
  assert.strictEqual(r.ops.length, sp.MAX_OPS);
  assert.ok(r.dropped.length >= 8);
});

test('existing names are reused, not recreated; refs resolve to them', () => {
  const r = sp.validatePlan([
    { op: 'create_text_channel', name: 'General' },
    { op: 'set_welcome_channel', channel: '#general' },
  ], mkState());
  assert.strictEqual(r.ops.length, 1);
  assert.strictEqual(r.ops[0].op, 'set_welcome_channel');
  assert.strictEqual(r.ops[0].channel.id, '111111111111111111');
  assert.ok(r.dropped.some((d) => /already exists/.test(d.reason)));
});

test('apply order: creates before configs, regardless of model order; planned refs point at earlier ops', () => {
  const r = sp.validatePlan([
    { op: 'setup_ticket_panel', channel: 'support', support_role: 'Helpers' },
    { op: 'set_welcome_channel', channel: 'welcome' },
    { op: 'create_role', name: 'Helpers' },
    { op: 'create_text_channel', name: 'welcome', category: 'Community' },
    { op: 'create_text_channel', name: 'support', category: 'Community' },
    { op: 'create_category', name: 'Community' },
  ], mkState());
  assert.deepStrictEqual(r.ops.map((o) => o.op), ['create_category', 'create_text_channel', 'create_text_channel', 'create_role', 'setup_ticket_panel', 'set_welcome_channel']);
  assert.strictEqual(r.ops[1].category.planned, 0);
  const ticket = r.ops[4];
  assert.strictEqual(ticket.channel.planned, 2);
  assert.strictEqual(ticket.support_role.planned, 3);
  assert.strictEqual(r.ops[5].channel.planned, 1);
  for (const [i, o] of r.ops.entries()) for (const ref of [o.category, o.channel, o.support_role, o.role]) if (ref && ref.planned !== undefined) assert.ok(ref.planned < i);
});

test('references that cannot be resolved drop the step', () => {
  const r = sp.validatePlan([
    { op: 'set_log_channel', kind: 'log', channel: 'nope' },
    { op: 'set_log_channel', kind: 'weird', channel: 'general' },
    { op: 'create_text_channel', name: 'x', category: 'Missing' },
    { op: 'setup_ticket_panel', channel: 'general' },
    { op: 'set_autorole', role: 'Ghost' },
  ], mkState());
  assert.strictEqual(r.ops.length, 0);
  assert.strictEqual(r.dropped.length, 5);
});

test('role hierarchy: autorole refuses @everyone, managed, above invoker', () => {
  const r = sp.validatePlan([
    { op: 'set_autorole', role: '@everyone' },
    { op: 'set_autorole', role: 'Botrole' },
    { op: 'set_autorole', role: 'Boss' },
    { op: 'set_autorole', role: 'Mods' },
  ], mkState());
  assert.deepStrictEqual(r.ops.map((o) => o.role.name), ['Mods']);
  assert.strictEqual(r.dropped.length, 3);
  // owner may hand out roles above their own, but never above the bot
  const owner = mkState({ invoker: { id: 'owner', ...perms('ManageRoles'), top: 1 } });
  assert.strictEqual(sp.validatePlan([{ op: 'set_autorole', role: 'Mods' }], owner).ops.length, 1);
  const high = mkState({ bot: { ...perms('ManageRoles'), top: 4 } });
  assert.strictEqual(sp.validatePlan([{ op: 'set_autorole', role: 'Mods' }], high).ops.length, 0);
});

test('permission mapping per op, Administrator covers all', () => {
  assert.deepStrictEqual(sp.PERMS.create_role, ['ManageRoles']);
  assert.deepStrictEqual(sp.PERMS.create_text_channel, ['ManageChannels']);
  assert.deepStrictEqual(sp.PERMS.set_welcome_channel, ['ManageGuild']);
  assert.ok(Object.keys(sp.FIELDS).every((k) => sp.PERMS[k]));
  const onlyChannels = mkState({ invoker: { id: 'u1', ...perms('ManageChannels'), top: 10 } });
  const r = sp.validatePlan([
    { op: 'create_category', name: 'A' },
    { op: 'create_role', name: 'R' },
    { op: 'set_welcome_channel', channel: 'general' },
  ], onlyChannels);
  assert.deepStrictEqual(r.ops.map((o) => o.op), ['create_category']);
  assert.strictEqual(r.dropped.filter((d) => /you need/.test(d.reason)).length, 2);
  const admin = mkState({ invoker: { id: 'u1', ...perms('Administrator'), top: 10 } });
  assert.strictEqual(sp.validatePlan([{ op: 'create_role', name: 'R' }, { op: 'set_welcome_channel', channel: 'general' }], admin).ops.length, 2);
  // the bot must be able to do it too
  const weakBot = mkState({ bot: { ...perms(), top: 20 } });
  assert.strictEqual(sp.validatePlan([{ op: 'create_category', name: 'A' }], weakBot).ops.length, 0);
});

test('channel limit of 500 and category child limit', () => {
  const many = Array.from({ length: 499 }, (_, i) => ({ id: `${3e17 + i}`, name: `c${i}`, type: 'text', parentId: null }));
  const full = mkState({ channels: [...many, { id: '444444444444444444', name: 'Cat', type: 'category', parentId: null }] });
  const r = sp.validatePlan([{ op: 'create_text_channel', name: 'one-too-many' }], full);
  assert.strictEqual(r.ops.length, 0);
  assert.ok(/500/.test(r.dropped[0].reason));
  const kids = Array.from({ length: 50 }, (_, i) => ({ id: `${5e17 + i}`, name: `k${i}`, type: 'text', parentId: '444444444444444444' }));
  const st = mkState({ channels: [{ id: '444444444444444444', name: 'Cat', type: 'category', parentId: null }, ...kids] });
  assert.strictEqual(sp.validatePlan([{ op: 'create_text_channel', name: 'x', category: 'Cat' }], st).ops.length, 0);
});

test('recheckOp: permissions lost, things deleted, names taken', () => {
  const st = mkState();
  const { ops } = sp.validatePlan([
    { op: 'create_role', name: 'Helpers' },
    { op: 'set_welcome_channel', channel: 'general' },
    { op: 'set_autorole', role: 'Mods' },
  ], st);
  const created = new Map();
  assert.strictEqual(sp.recheckOp(ops[0], 0, st, created), null);
  assert.ok(/Manage Roles/.test(sp.recheckOp(ops[0], 0, mkState({ invoker: { id: 'u1', ...perms('ManageGuild'), top: 10 } }), created)));
  assert.ok(/no longer exists/.test(sp.recheckOp(ops[1], 1, mkState({ channels: [] }), created)));
  assert.ok(/now exists/.test(sp.recheckOp(ops[0], 0, mkState({ roles: [...st.roles, { id: '9', name: 'helpers', position: 1 }] }), created)));
  assert.ok(/at or above/.test(sp.recheckOp(ops[2], 2, mkState({ roles: st.roles.map((r) => (r.name === 'Mods' ? { ...r, position: 99 } : r)) }), created)));
});

test('applyPlan: sequential in order, planned ids flow into later ops', async () => {
  const st = mkState();
  const { ops } = sp.validatePlan([
    { op: 'set_welcome_channel', channel: 'hello' },
    { op: 'create_text_channel', name: 'hello', category: 'Lobby' },
    { op: 'create_category', name: 'Lobby' },
  ], st);
  const calls = [];
  const result = await sp.applyPlan(ops, {
    recheck: async (op, i) => { calls.push(`check:${i}`); return null; },
    exec: async (op, i, created) => {
      calls.push(`run:${i}:${op.op}`);
      if (op.op === 'create_category') return { id: 'cat1' };
      if (op.op === 'create_text_channel') { assert.strictEqual(sp.idOf(op.category, created), 'cat1'); return { id: 'chan1' }; }
      assert.strictEqual(sp.idOf(op.channel, created), 'chan1');
      return {};
    },
  });
  assert.deepStrictEqual(calls, ['check:0', 'run:0:create_category', 'check:1', 'run:1:create_text_channel', 'check:2', 'run:2:set_welcome_channel']);
  assert.strictEqual(result.done.length, 3);
  assert.strictEqual(result.failed, null);
  assert.strictEqual(result.notRun.length, 0);
});

test('applyPlan: stops on first failure and reports done / failed / not run', async () => {
  const ops = [{ op: 'a', text: 'one' }, { op: 'b', text: 'two' }, { op: 'c', text: 'three' }];
  const ran = [];
  const r = await sp.applyPlan(ops, { recheck: () => null, exec: async (op) => { ran.push(op.op); if (op.op === 'b') throw new Error('Missing Permissions'); return {}; } });
  assert.deepStrictEqual(ran, ['a', 'b']);
  assert.deepStrictEqual(r.done.map((d) => d.text), ['one']);
  assert.strictEqual(r.failed.text, 'two');
  assert.strictEqual(r.failed.stage, 'run');
  assert.deepStrictEqual(r.notRun.map((d) => d.text), ['three']);
});

test('applyPlan: a failed re-check before an op stops the run without executing it', async () => {
  const ops = [{ op: 'a', text: 'one' }, { op: 'b', text: 'two' }];
  const ran = [];
  const r = await sp.applyPlan(ops, { recheck: (op) => (op.op === 'b' ? 'you need Manage Roles for that' : null), exec: async (op) => { ran.push(op.op); return {}; } });
  assert.deepStrictEqual(ran, ['a']);
  assert.strictEqual(r.failed.stage, 'check');
  assert.deepStrictEqual(r.notRun, []);
  // a re-check that throws also fails closed
  const r2 = await sp.applyPlan(ops, { recheck: () => { throw new Error('boom'); }, exec: async () => { throw new Error('should not run'); } });
  assert.strictEqual(r2.done.length, 0);
  assert.strictEqual(r2.failed.stage, 'check');
});

test('model prompt carries names only and tells the model the request is data', () => {
  const m = sp.buildMessages('set up tickets', mkState());
  assert.strictEqual(m[0].role, 'system');
  assert.ok(/data, not instructions/.test(m[0].content));
  assert.ok(/general/.test(m[1].content) && !/@everyone/.test(m[1].content));
});
