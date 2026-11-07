// Punishment presets wired into /mute, /tempban and /warn add: pure helper tests plus command runs with fakes.
// The store is replaced in the require cache, so data/sonder.db is never opened.
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
  getWarnings: (g, u) => warnings.filter((w) => w.g === g && w.u === u).map((w, i) => ({ id: i + 1, ...w })),
  clearWarnings: () => 0,
};
const storePath = require.resolve(path.join(__dirname, '..', 'src', 'database', 'store.js'));
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: fakeStore };

const PrefixContext = require('../src/utils/prefixContext');
const presets = require('../src/utils/presets');
const pa = require('../src/utils/presetApply');
const infractions = require('../src/database/infractions');
const mute = require('../src/commands/moderation/mute');
const tempban = require('../src/commands/moderation/tempban');
const warn = require('../src/commands/moderation/warn');

const H = 3600000;
const D = 86400000;
const spam = { action: 'mute', durationMs: H, reason: 'Spamming' };

// ---- pure helpers ----
test('resolve: no preset passes the moderator input through untouched', () => {
  assert.deepStrictEqual(pa.resolve({ action: 'mute', presetName: null, preset: null, duration: '10m', reason: 'x' }),
    { durationMs: null, reason: 'x', note: null, presetName: null });
});

test('resolve: unknown preset and action mismatch are clear errors', () => {
  assert.match(pa.resolve({ action: 'mute', presetName: 'nope', preset: null }).error, /No preset named `nope`/);
  const r = pa.resolve({ action: 'tempban', presetName: 'spam', preset: spam });
  assert.match(r.error, /is a \*\*mute\*\* preset, not tempban/);
});

test('resolve: preset fills duration and reason the moderator left out, capped by the command', () => {
  assert.deepStrictEqual(pa.resolve({ action: 'mute', presetName: 'Spam', preset: spam, duration: null, reason: null, maxMs: 28 * D }),
    { durationMs: H, reason: 'Spamming', note: null, presetName: 'spam' });
  const big = { action: 'mute', durationMs: 40 * D, reason: null }; // hand-edited config beyond the cap
  assert.strictEqual(pa.resolve({ action: 'mute', presetName: 'big', preset: big, maxMs: 28 * D }).durationMs, 28 * D);
  // the moderator's own reason wins
  assert.strictEqual(pa.resolve({ action: 'mute', presetName: 'spam', preset: spam, reason: 'mine' }).reason, 'mine');
});

test('resolve: a different explicit duration adds one difference line; the same one adds none', () => {
  const r = pa.resolve({ action: 'mute', presetName: 'spam', preset: spam, duration: '2h', reason: null, maxMs: 28 * D });
  assert.strictEqual(r.note, 'Differs from preset "spam" (mute 1h)');
  assert.strictEqual(r.durationMs, null); // the command parses the moderator's own 2h
  assert.strictEqual(pa.resolve({ action: 'mute', presetName: 'spam', preset: spam, duration: '60m' }).note, null);
  // warn presets have no duration, so nothing can differ
  assert.strictEqual(pa.resolve({ action: 'warn', presetName: 'w', preset: { action: 'warn', durationMs: null, reason: 'r' } }).note, null);
});

test('splitPrefixWords: preset:NAME token in the duration slot or anywhere in the reason', () => {
  assert.deepStrictEqual(pa.splitPrefixWords('preset:spam', null), { duration: null, reason: null, presetName: 'spam' });
  assert.deepStrictEqual(pa.splitPrefixWords('preset:spam', '2h being loud'), { duration: '2h', reason: 'being loud', presetName: 'spam' });
  assert.deepStrictEqual(pa.splitPrefixWords('2h', 'being preset:spam loud'), { duration: '2h', reason: 'being loud', presetName: 'spam' });
  assert.deepStrictEqual(pa.splitPrefixWords(null, 'preset:rude said things', { hasDuration: false }), { duration: null, reason: 'said things', presetName: 'rude' });
});

// ---- command runs with fakes ----
function world() {
  const sentLog = [];
  const g = {
    id: 'G1', name: 'Test', ownerId: '100000000000000001',
    channels: { cache: new Map() }, roles: { cache: new Map() },
    members: {
      cache: new Map(),
      fetch: async () => { throw new Error('unknown'); },
      ban: async (id, o) => { sentLog.push(['ban', id, o.reason]); },
      me: { permissions: { has: () => true } },
    },
  };
  const users = new Map();
  const mk = (id, tag) => { const u = { id, tag, bot: false, displayAvatarURL: () => null, send: async () => {} }; users.set(id, u); return u; };
  const modUser = mk('200000000000000002', 'mod#1');
  const target = mk('300000000000000003', 'target#1');
  g.client = { user: { id: '900000000000000009', tag: 'mofu#1', displayAvatarURL: () => null }, users: { cache: users } };
  const modMember = { id: modUser.id, user: modUser, permissions: { has: () => true }, roles: { highest: { position: 10 } } };
  const calls = [];
  g.members.cache.set(target.id, {
    id: target.id, user: target, roles: { highest: { position: 1 } }, manageable: true, moderatable: true, bannable: true,
    timeout: async (ms, r) => calls.push(['timeout', ms, r]),
  });
  return { g, sentLog, modUser, target, modMember, calls };
}
function run(cmd, argv, w) {
  const replies = [];
  const message = {
    guild: w.g, guildId: w.g.id, channel: {}, channelId: 'C', author: w.modUser, member: w.modMember, client: w.g.client,
    attachments: new Map(), createdTimestamp: Date.now(), content: '',
    reply: async (d) => { replies.push(d); return { edit: async () => {}, delete: async () => {} }; },
  };
  const ctx = new PrefixContext(message, argv.slice(), cmd);
  assert.deepStrictEqual(ctx._invalid, [], 'prefix parse should accept this input');
  return cmd.execute(ctx).then(() => replies);
}
const desc = (replies) => replies.map((r) => r.embeds?.[0]?.data?.description || '').join('\n');
const setPresets = (t) => presets.savePresets('G1', t);

test('mute: old prefix usage parses exactly as before (multi-word reason, default 30m)', async () => {
  setPresets({});
  const w = world();
  await run(mute, [`<@${w.target.id}>`, '10m', 'being', 'very', 'loud'], w);
  assert.deepStrictEqual(w.calls[0], ['timeout', 600000, 'being very loud']);
  const w2 = world();
  await run(mute, [`<@${w2.target.id}>`], w2);
  assert.deepStrictEqual(w2.calls[0], ['timeout', 30 * 60000, 'No reason provided']);
});

test('mute: preset fills duration and reason; an explicit different duration still mutes, with the line', async () => {
  setPresets({ spam: spam, raid: { action: 'tempban', durationMs: 7 * D, reason: null } });
  let w = world();
  let replies = await run(mute, [`<@${w.target.id}>`, 'preset:spam'], w);
  assert.deepStrictEqual(w.calls[0], ['timeout', H, 'Spamming']);
  assert.doesNotMatch(desc(replies), /Differs/);

  w = world();
  replies = await run(mute, [`<@${w.target.id}>`, '2h', 'kept', 'going', 'preset:spam'], w);
  assert.deepStrictEqual(w.calls[0], ['timeout', 2 * H, 'kept going']);
  assert.match(desc(replies), /Differs from preset "spam" \(mute 1h\)/);

  w = world();
  replies = await run(mute, [`<@${w.target.id}>`, 'preset:raid'], w);
  assert.strictEqual(w.calls.length, 0);
  assert.match(desc(replies), /is a \*\*tempban\*\* preset, not mute/);

  w = world();
  replies = await run(mute, [`<@${w.target.id}>`, '40d', 'preset:spam'], w);
  assert.strictEqual(w.calls.length, 0, 'the 28 day cap still applies to an explicit duration');
  assert.match(desc(replies), /cannot exceed 28 days/);
});

test('mute: slash interaction uses the preset option directly', async () => {
  setPresets({ spam });
  const w = world();
  const replies = [];
  const opts = { user: w.target.id, duration: '45m', preset: 'spam' };
  const interaction = {
    guild: w.g, client: w.g.client, user: w.modUser, member: w.modMember,
    options: { getMember: () => w.g.members.cache.get(opts.user), getString: (n) => opts[n] ?? null },
    reply: async (d) => { replies.push(d); },
  };
  await mute.execute(interaction);
  assert.deepStrictEqual(w.calls[0], ['timeout', 45 * 60000, 'Spamming']);
  assert.match(desc(replies), /Differs from preset "spam" \(mute 1h\)/);
});

test('tempban: preset supplies the duration; old usage unchanged; neither asks for one', async () => {
  setPresets({ raid: { action: 'tempban', durationMs: 7 * D, reason: 'Raiding' } });
  let w = world();
  const before = Date.now();
  await run(tempban, [`<@${w.target.id}>`, 'preset:raid'], w);
  assert.strictEqual(w.sentLog[0][0], 'ban');
  let row = infractions.getTempban('G1', w.target.id);
  assert.ok(row.expires_at >= before + 7 * D - 1000 && row.expires_at <= Date.now() + 7 * D + 1000);
  assert.strictEqual(infractions.getCase('G1', row.case_id).reason, 'Raiding');

  w = world();
  w.target.id = '300000000000000004';
  w.g.client.users.cache.set(w.target.id, w.target);
  w.g.members.cache.set(w.target.id, { ...w.g.members.cache.get('300000000000000003'), id: w.target.id });
  const replies = await run(tempban, [`<@${w.target.id}>`, '2d', 'raid', 'spam'], w);
  row = infractions.getTempban('G1', w.target.id);
  assert.strictEqual(infractions.getCase('G1', row.case_id).reason, 'raid spam');
  assert.doesNotMatch(desc(replies), /Differs/);

  w = world();
  assert.match(desc(await run(tempban, [`<@${w.target.id}>`], w)), /Give a duration/);
  assert.strictEqual(w.sentLog.length, 0);
});

test('warn add: preset default reason stands in; no reason and no preset is refused', async () => {
  setPresets({ rude: { action: 'warn', durationMs: null, reason: 'Be kind' } });
  let w = world();
  await run(warn, ['add', `<@${w.target.id}>`, 'preset:rude'], w);
  assert.strictEqual(warnings.at(-1).reason, 'Be kind');
  w = world();
  await run(warn, ['add', `<@${w.target.id}>`, 'said', 'mean', 'things'], w);
  assert.strictEqual(warnings.at(-1).reason, 'said mean things');
  const n = warnings.length;
  w = world();
  assert.match(desc(await run(warn, ['add', `<@${w.target.id}>`], w)), /Give a reason/);
  assert.strictEqual(warnings.length, n);
});

test('autocomplete lists only presets for that command', async () => {
  setPresets({ spam, raid: { action: 'tempban', durationMs: 7 * D, reason: null }, flood: { action: 'mute', durationMs: 10 * 60000, reason: null } });
  let got = null;
  await pa.autocomplete({ guild: { id: 'G1' }, options: { getFocused: () => '' }, respond: async (c) => { got = c; } }, 'mute');
  assert.deepStrictEqual(got.map((c) => c.value), ['flood', 'spam']);
});

test('slash JSON stays valid: preset last, required before optional, descriptions within limits', () => {
  for (const cmd of [mute, tempban, warn]) {
    const j = cmd.data.toJSON();
    const opts = j.options[0]?.type === 1 ? j.options.find((o) => o.name === 'add').options : j.options;
    assert.strictEqual(opts.at(-1).name, 'preset', j.name);
    assert.strictEqual(opts.at(-1).autocomplete, true);
    const firstOpt = opts.findIndex((o) => !o.required);
    assert.ok(!opts.slice(firstOpt).some((o) => o.required), j.name);
    for (const o of opts) assert.ok(o.description.length >= 1 && o.description.length <= 100, `${j.name}.${o.name}`);
  }
});
