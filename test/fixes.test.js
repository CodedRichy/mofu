// Regression tests for the review-fix batch: QR header guard, appeal rules, /forgetme crowns, feed SSRF lookup,
// staff snapshot cache, voice-ban concurrency, lock/hide restore, image alert double press, voice alert rank,
// prefix replies that survive a deleted source message. Pure logic and fakes: no network, no Discord.
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

// ---- qrscan: dimensions are read from the header before any decoder allocates ----
const qr = require('../src/utils/qrscan');

const pngHeader = (w, h) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
};
const gifHeader = (w, h) => { const b = Buffer.alloc(13); b.write('GIF89a', 0, 'latin1'); b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8); return b; };
const webpX = (w, h) => {
  const b = Buffer.alloc(32); b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1'); b.write('VP8X', 12, 'latin1');
  b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); return b;
};
const jpegHeader = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);

test('qrscan.headerDims reads png, gif, webp and jpeg sizes without decoding', () => {
  assert.deepStrictEqual(qr.headerDims(pngHeader(15000, 15000)), { width: 15000, height: 15000 });
  assert.deepStrictEqual(qr.headerDims(gifHeader(640, 480)), { width: 640, height: 480 });
  assert.deepStrictEqual(qr.headerDims(webpX(4000, 3000)), { width: 4000, height: 3000 });
  assert.deepStrictEqual(qr.headerDims(jpegHeader(5000, 4000)), { width: 5000, height: 4000 });
  assert.strictEqual(qr.headerDims(Buffer.from('not an image')), null);
});

test('qrscan.decodeBuffer skips oversized or unparseable images before decoding', async () => {
  for (const buf of [pngHeader(15000, 15000), gifHeader(20000, 20000), webpX(16000, 16000), jpegHeader(8000, 8000), pngHeader(0, 0), Buffer.from('garbage bytes here')]) {
    const out = await qr.decodeBuffer(buf);
    assert.strictEqual(out.status, 'skipped');
    assert.deepStrictEqual(out.urls, []);
  }
});

// ---- appeals ----
const appealH = require('../src/handlers/appeal');

test('appeal: tempban is not appealable; a mute appeal must be the newest active mute case', () => {
  assert.ok(!appealH.APPEALABLE.includes('tempban'));
  assert.match(appealH.eligibilityProblem({ case_id: 1, target_id: 'u', action: 'tempban', status: 'active' }, 'u'), /Only mute/);
  const cases = [
    { case_id: 9, action: 'warn', status: 'active' },
    { case_id: 8, action: 'mute', status: 'void' },
    { case_id: 7, action: 'mute', status: 'active' },
    { case_id: 5, action: 'mute', status: 'active' },
  ];
  assert.strictEqual(appealH.isLatestMuteCase(cases, 7), true);
  assert.strictEqual(appealH.isLatestMuteCase(cases, 5), false);
  assert.strictEqual(appealH.isLatestMuteCase([], 5), false);
});

// ---- /forgetme leaves no crown rows or Last.fm markers ----
const privacy = require('../src/database/privacy');

test('forgetUser removes Last.fm crowns, activity and hide keys but keeps other members', () => {
  const U = '111111111111111111'; const O = '222222222222222222'; const G = '333333333333333333';
  const db = new Database(':memory:');
  db.exec('CREATE TABLE config (guild_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY (guild_id, key));');
  const put = (k, v) => db.prepare('INSERT INTO config VALUES (?, ?, ?)').run(G, k, JSON.stringify(v));
  put('fm_crowns', { a: { a: 'artist a', u: U, p: 9 }, b: { a: 'artist b', u: O, p: 7 } });
  put('fmact_' + U, 1); put('fmhide_' + U, true); put('lastfm_' + U, 'name');
  const r = privacy.forgetUser(db, U);
  assert.ok(r.guilds.includes(G));
  const crowns = JSON.parse(db.prepare("SELECT value FROM config WHERE key = 'fm_crowns'").get().value);
  assert.deepStrictEqual(Object.keys(crowns), ['b']);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM config WHERE key LIKE ?').get('%' + U).n, 0);
  // the last crown going removes the row entirely
  privacy.forgetUser(db, O);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM config WHERE key = 'fm_crowns'").get().n, 0);
});

// ---- feed fetch: the connection uses the checked address ----
const alerts = require('../src/utils/alerts');

test('guardedLookup refuses private answers and passes public ones through', async () => {
  const run = (addrs, opts) => new Promise((resolve) => alerts.guardedLookup(async () => addrs)('rebind.example', opts, (err, a, f) => resolve({ err, a, f })));
  assert.match((await run([{ address: '127.0.0.1', family: 4 }], {})).err.message, /Private/);
  assert.match((await run([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }], { all: true })).err.message, /Private/);
  const ok = await run([{ address: '93.184.216.34', family: 4 }], { all: true });
  assert.deepStrictEqual(ok.a, [{ address: '93.184.216.34', family: 4 }]);
  const one = await run([{ address: '93.184.216.34', family: 4 }], {});
  assert.strictEqual(one.a, '93.184.216.34');
});

// ---- scamshield: staff snapshot is cached ----
const scamshield = require('../src/utils/scamshield');

test('staffSnapshot scans the member cache once per minute per guild', () => {
  let scans = 0;
  const guild = { id: 'snap-guild', members: { cache: { values() { scans++; return [][Symbol.iterator](); } } } };
  scamshield.staffSnapshot(guild, 1000);
  scamshield.staffSnapshot(guild, 30000);
  assert.strictEqual(scans, 1);
  scamshield.staffSnapshot(guild, 70000);
  assert.strictEqual(scans, 2);
});

// ---- voice ban: bounded parallel overwrite edits ----
const voicecase = require('../src/utils/voicecase');

test('applyVoiceBan edits at most 5 channels at a time and counts them all', async () => {
  let inflight = 0; let peak = 0;
  const chans = new Map();
  for (let i = 0; i < 12; i++) {
    chans.set('c' + i, { isVoiceBased: () => true, manageable: true, permissionOverwrites: { edit: async () => { inflight++; peak = Math.max(peak, inflight); await new Promise((r) => setTimeout(r, 3)); inflight--; } } });
  }
  const guild = { channels: { cache: chans }, roles: { cache: new Map() } };
  const out = await voicecase.applyVoiceBan(guild, { id: 'm', voice: {} }, { reason: 'r' });
  assert.strictEqual(out.touched, 12);
  assert.ok(peak <= 5 && peak > 1, 'peak ' + peak);
});

// ---- /lock off restores a channel that was already read-only ----
const store = require('../src/database/store');

test('/lock on then off keeps a pre-existing @everyone SendMessages deny', async () => {
  const kv = new Map();
  const orig = { g: store.getConfig, s: store.setConfig };
  store.getConfig = (g, k) => kv.get(k) ?? null;
  store.setConfig = (g, k, v) => { if (v === null || v === undefined) kv.delete(k); else kv.set(k, v); };
  try {
    const lock = require('../src/commands/moderation/lock');
    const edits = [];
    const channel = {
      id: 'ch1', toString: () => '#ch1',
      permissionOverwrites: {
        cache: new Map([['everyone', { allow: { has: () => false }, deny: { has: () => true } }]]),
        edit: async (_r, perms) => { edits.push(perms.SendMessages); },
      },
    };
    const mk = (sub) => ({
      options: { getSubcommand: () => sub, getChannel: () => null, getString: () => null },
      channel, guild: { id: 'g', roles: { everyone: { id: 'everyone' } }, channels: { cache: new Map() }, client: {} },
      client: {}, user: { id: 'm', tag: 'm#0' }, reply: async () => {},
    });
    await lock.execute(mk('on'));
    await lock.execute(mk('off'));
    assert.deepStrictEqual(edits, [false, false]);
  } finally {
    store.getConfig = orig.g; store.setConfig = orig.s;
  }
});

// ---- prefix replies do not depend on the source message still existing ----
const PrefixContext = require('../src/utils/prefixContext');
const { SlashCommandBuilder } = require('discord.js');

test('PrefixContext replies set failIfNotExists false', async () => {
  const seen = [];
  const message = { author: { id: '1' }, member: {}, channel: {}, client: {}, guild: {}, guildId: 'g', channelId: 'c', createdTimestamp: 0, attachments: new Map(), reply: async (d) => { seen.push(d); return { edit: async (e) => { seen.push(e); } }; } };
  const ctx = new PrefixContext(message, [], { data: new SlashCommandBuilder().setName('x').setDescription('x') });
  await ctx.reply({ content: 'a' });
  await ctx.followUp({ content: 'b' });
  await ctx.deferReply();
  assert.ok(seen.length === 3 && seen.every((d) => d.failIfNotExists === false));
});

// ---- image alert: a second press while the first is in flight does nothing ----
test('image alert buttons ignore a second press while the first is still being checked', async () => {
  const { shared } = require('../src/ai/actions');
  const handler = require('../src/handlers/imagemod');
  const imagemodUtil = require('../src/utils/imagemod');
  const saved = { rec: shared.audit.record, res: shared.audit.resolve, bump: imagemodUtil.bumpUsage };
  shared.audit.record = () => 1; shared.audit.resolve = () => {}; imagemodUtil.bumpUsage = () => {};
  shared.pending.set('dbl1', { kind: 'imagemod', guildId: 'g', channelId: 'c', authorId: 'a', messageId: 'm', category: 'x', timer: null });
  try {
    const member = { permissions: { has: () => true } };
    const guild = { id: 'g', ownerId: 'o', client: { user: { id: 'bot' } }, channels: { cache: { get: () => undefined } }, members: { fetch: async () => { await new Promise((r) => setTimeout(r, 10)); return member; } } };
    const calls = { defer: 0, replies: [] };
    const press = (id) => ({
      id, customId: 'imagemod:dbl1:no', guild, user: { id: 'mod', tag: 'mod#0' }, client: {}, message: null,
      reply: async (d) => { calls.replies.push(d); }, deferUpdate: async () => { calls.defer++; }, editReply: async () => {}, followUp: async () => {},
    });
    await Promise.all([handler.handleButton(press('i1')), handler.handleButton(press('i2'))]);
    assert.strictEqual(calls.defer, 1);
    assert.strictEqual(calls.replies.length, 1);
  } finally {
    shared.audit.record = saved.rec; shared.audit.resolve = saved.res; imagemodUtil.bumpUsage = saved.bump;
    shared.pending.delete('dbl1');
  }
});

// ---- voice alert: a press that cannot act does not use the alert up ----
test('voice alert stays open when the presser outranks nobody, and works for a qualified presser', async () => {
  const voiceguard = require('../src/utils/voiceguard');
  const pending = new Map();
  const resolved = [];
  const shared = { pending, resultCard: () => ({}), NO_PINGS: { parse: [] }, audit: { record: () => 1, resolve: (id, st) => resolved.push(st) } };
  const target = { id: 't1', user: { id: 't1', tag: 't#0' }, roles: { highest: { position: 5 } }, voice: { channelId: 'v', disconnect: async () => { target.disconnected++; } }, disconnected: 0 };
  const presser = (pos) => ({ id: 'p' + pos, permissions: { has: () => true }, roles: { highest: { position: pos } } });
  const people = { p1: presser(1), p9: presser(9) };
  const card = { edit: async () => {} };
  const guild = {
    id: 'g', ownerId: 'owner', client: { user: { displayAvatarURL: () => undefined } },
    channels: { cache: { get: () => ({ send: async () => card }) } },
    members: { fetch: async (a) => (typeof a === 'object' ? people[a.user] : target) },
  };
  const out = await voiceguard.propose(
    { guild, kind: 'flap', userIds: ['t1'], channelId: 'v' },
    { actions: { shared }, store: { getConfig: () => 'chan' }, modlog: { openCase: () => 1, send: async () => {} } },
  );
  assert.ok(out);
  const [idDisc] = [...pending.keys()];
  const shown = [];
  const followUps = [];
  const interaction = (uid) => ({ user: { id: uid, tag: uid + '#0' }, client: {}, followUp: async (d) => { followUps.push(d); } });
  await pending.get(idDisc).onConfirm({ interaction: interaction('p1'), p: {}, show: async (d) => { shown.push(d); } });
  assert.strictEqual(target.disconnected, 0);
  assert.strictEqual(pending.size, 2, 'both buttons are registered again');
  assert.strictEqual(followUps.length, 1);
  assert.ok(shown[0].components && shown[0].components.length === 1, 'card gets its buttons back');
  assert.deepStrictEqual(resolved, []);

  await pending.get(idDisc).onConfirm({ interaction: interaction('p9'), p: {}, show: async (d) => { shown.push(d); } });
  assert.strictEqual(target.disconnected, 1);
  assert.strictEqual(pending.size, 0);
  assert.deepStrictEqual(resolved, ['executed']);
});
