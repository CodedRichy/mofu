const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const vc = require('../src/utils/voicecase');

const S = (channelId, extra = {}) => ({ channelId, serverMute: false, serverDeaf: false, streaming: false, selfVideo: false, ...extra });

test('diffEvents: join, leave, move and toggles', () => {
  assert.deepStrictEqual(vc.diffEvents(S(null), S('a')).map((e) => e.type), ['join']);
  assert.deepStrictEqual(vc.diffEvents(S('a'), S(null)).map((e) => e.type), ['leave']);
  const mv = vc.diffEvents(S('a'), S('b'));
  assert.deepStrictEqual(mv.map((e) => [e.type, e.channelId, e.other]), [['move_out', 'a', 'b'], ['move_in', 'b', 'a']]);
  const tg = vc.diffEvents(S('a'), S('a', { serverMute: true, streaming: true, selfVideo: true, serverDeaf: true }));
  assert.deepStrictEqual(tg.map((e) => e.type).sort(), ['sdeaf', 'smute', 'stream', 'video']);
  assert.ok(tg.every((e) => e.on === true));
  assert.deepStrictEqual(vc.diffEvents(S('a'), S('a')), []); // self mute/deafen and no-ops are not events
  assert.deepStrictEqual(vc.diffEvents(S('a', { serverMute: true }), S(null)).map((e) => e.type), ['leave']);
});

test('buffer keeps ids and times only, trims to the window and the cap', () => {
  const b = vc.createBuffer({ windowMs: 1000, maxEvents: 3 });
  const t0 = 1_000_000;
  b.recordStates('g', 'u1', S(null), S('c'), t0);
  b.recordStates('g', 'u2', S(null), S('c'), t0 + 100);
  const snap = b.snapshot('g', 'c', t0 + 200);
  assert.deepStrictEqual(snap.map((e) => Object.keys(e).sort()), [['t', 'type', 'uid'], ['t', 'type', 'uid']]);
  b.recordStates('g', 'u3', S(null), S('c'), t0 + 300);
  b.recordStates('g', 'u4', S(null), S('c'), t0 + 400);
  assert.deepStrictEqual(b.snapshot('g', 'c', t0 + 500).map((e) => e.uid), ['u2', 'u3', 'u4']); // cap 3
  assert.deepStrictEqual(b.snapshot('g', 'c', t0 + 1350).map((e) => e.uid), ['u4']); // window
  assert.deepStrictEqual(b.snapshot('g', 'other', t0), []);
});

test('a move is recorded in both channels', () => {
  const b = vc.createBuffer();
  b.recordStates('g', 'u', S('a'), S('b'), 5000);
  assert.deepStrictEqual(b.snapshot('g', 'a', 5000).map((e) => e.type), ['move_out']);
  assert.deepStrictEqual(b.snapshot('g', 'b', 5000).map((e) => e.type), ['move_in']);
});

test('idle channels are dropped and the channel count is capped', () => {
  const b = vc.createBuffer({ idleDropMs: 1000, maxChannels: 2 });
  b.recordStates('g', 'u', S(null), S('a'), 0);
  b.recordStates('g', 'u', S(null), S('b'), 500);
  assert.strictEqual(b.size(), 2);
  b.prune(1200);
  assert.strictEqual(b.size(), 1); // a idle > 1000, b not yet
  b.prune(1600);
  assert.strictEqual(b.size(), 0);
  const c = vc.createBuffer({ maxChannels: 2 });
  for (let i = 0; i < 5; i++) c.recordStates('g', 'u', S(null), S(`ch${i}`), i);
  c.prune(10);
  assert.strictEqual(c.size(), 2);
  assert.ok(c.snapshot('g', 'ch4', 10).length === 1 && c.snapshot('g', 'ch0', 10).length === 0);
});

test('record ignores empty input', () => {
  const b = vc.createBuffer();
  b.record('g', null, { channelId: 'c', type: 'join' });
  b.record('g', 'u', { type: 'join' });
  assert.strictEqual(b.size(), 0);
});

test('compactSnapshot fits the case limit, drops oldest events first and round-trips', () => {
  const at = 2_000_000;
  const events = [];
  for (let i = 0; i < 80; i++) events.push({ t: at - (80 - i) * 1000, type: i % 3 ? 'join' : 'smute', uid: `1000000000000000${String(i % 12).padStart(2, '0')}`, ...(i % 3 ? {} : { on: true }) });
  const members = ['100000000000000001', '100000000000000002'];
  const r = vc.compactSnapshot({ channelId: '555555555555555555', at, memberIds: members, events, note: 'soundboard spam' });
  assert.ok(r.json.length <= vc.SNAPSHOT_MAX_LEN);
  assert.ok(r.dropped > 0 && r.kept + r.dropped === 80);
  const back = vc.parseCaseSnapshot(r.json);
  assert.strictEqual(back.channelId, '555555555555555555');
  assert.strictEqual(back.note, 'soundboard spam');
  assert.deepStrictEqual(back.memberIds, members);
  assert.strictEqual(back.events.length, r.kept);
  assert.strictEqual(back.events[back.events.length - 1].t, events[79].t); // the newest event survives
});

test('compactSnapshot with a tiny limit degrades instead of throwing', () => {
  const r = vc.compactSnapshot({ channelId: 'c', at: 1000, memberIds: ['1', '2', '3'], events: [{ t: 0, type: 'join', uid: '1' }] }, 60);
  assert.ok(r.json.length <= 70);
  assert.ok(vc.parseCaseSnapshot(r.json));
});

test('parseCaseSnapshot rejects other text', () => {
  assert.strictEqual(vc.parseCaseSnapshot('No reason provided'), null);
  assert.strictEqual(vc.parseCaseSnapshot('{"a":1}'), null);
});

test('renderTimeline is oldest-to-newest, capped, and uses mentions', () => {
  const evs = [{ t: 3000, type: 'leave', uid: '2' }, { t: 1000, type: 'join', uid: '1' }, { t: 2000, type: 'stream', uid: '1', on: true }];
  const lines = vc.renderTimeline(evs, 2);
  assert.strictEqual(lines.length, 2);
  assert.match(lines[0], /<@1> started a stream/);
  assert.match(lines[1], /<@2> left/);
});

test('report limiter: per key, sliding window', () => {
  const l = vc.createLimiter({ max: 2, windowMs: 1000 });
  assert.ok(l.take('a', 0));
  assert.ok(l.take('a', 10));
  assert.ok(!l.take('a', 20));
  assert.ok(l.take('b', 20));
  assert.ok(l.take('a', 1100));
});

test('voice ban and lockdown tables', () => {
  const t = vc.create(new Database(':memory:'));
  t.addBan({ guildId: 'g', userId: 'u', expiresAt: 100, method: 'overwrite', caseId: 4, now: 1 });
  assert.strictEqual(t.getBan('g', 'u').case_id, 4);
  assert.strictEqual(t.dueBans(99).length, 0);
  assert.strictEqual(t.dueBans(100).length, 1);
  assert.ok(t.removeBan('g', 'u'));
  assert.strictEqual(t.getBan('g', 'u'), null);
  t.addLockdown({ guildId: 'g', channelId: 'c', prev: { UseSoundboard: 'allow', Speak: 'none' }, caseId: 2 });
  assert.deepStrictEqual(t.getLockdown('g', 'c').prev, { UseSoundboard: 'allow', Speak: 'none' });
  assert.ok(t.removeLockdown('g', 'c'));
  assert.strictEqual(t.getLockdown('g', 'c'), null);
});

test('a voice_report case carries the snapshot through the case helper', () => {
  const inf = require('../src/database/infractions').create(new Database(':memory:'));
  const snap = vc.compactSnapshot({ channelId: 'c', at: 5000, memberIds: ['1'], events: [{ t: 4000, type: 'join', uid: '1' }] });
  const n = inf.openCase({ guildId: 'g', action: 'voice_report', moderatorId: 'm', reason: snap.json });
  assert.strictEqual(n, 1);
  assert.deepStrictEqual(vc.parseCaseSnapshot(inf.getCase('g', 1).reason).memberIds, ['1']);
});
