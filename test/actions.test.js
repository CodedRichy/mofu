const test = require('node:test');
const assert = require('node:assert');
const { parseMuteIntent, usageHint } = require('../src/ai/actions');
const { parse, format } = require('../src/utils/duration');

const BOT = '999';
const T = (id) => `<@${id}>`;

test('mute with mention, duration and reason', () => {
  const r = parseMuteIntent(`sonder mute ${T(111)} 10m for spamming`, BOT);
  assert.deepStrictEqual(r.targetIds, ['111']);
  assert.strictEqual(r.duration, '10m');
  assert.strictEqual(r.reason, 'spamming');
});

test('defaults to 30m and no reason', () => {
  const r = parseMuteIntent(`yo sonder mute ${T(111)}`, BOT);
  assert.strictEqual(r.duration, '30m');
  assert.strictEqual(r.reason, 'No reason provided');
});

test('typed name target', () => {
  const r = parseMuteIntent('SONDER MUTE KAI 30S', BOT);
  assert.strictEqual(r.targetName, 'KAI');
  assert.strictEqual(r.duration, '30s');
});

test('questions and chatter are not actions', () => {
  for (const s of ['sonder how do i mute someone', `sonder what happens if i mute ${T(111)}?`, 'sonder mute', 'sonder mute him', 'sonder can i mute people here', `${T(BOT)} mute ${T(BOT)}`]) {
    assert.strictEqual(parseMuteIntent(s, BOT), null, s);
  }
});

test('@everyone is stripped from reasons', () => {
  const r = parseMuteIntent(`hey sonder mute ${T(111)} 1d cuz raiding @everyone`, BOT);
  assert.strictEqual(r.reason, 'raiding');
});

test('duration parse/format', () => {
  assert.strictEqual(parse('30m'), 1800000);
  assert.strictEqual(parse('1h'), 3600000);
  assert.ok(!parse('abc'));
  assert.match(format(3600000), /1/);
});

test('unmute is parsed as its own action, not a mute', () => {
  const r = parseMuteIntent(`sonder unmute ${T(111)}`, BOT);
  assert.strictEqual(r.kind, 'unmute');
  assert.deepStrictEqual(r.targetIds, ['111']);
  assert.strictEqual(parseMuteIntent(`yo sonder un mute ${T(111)} cuz he apologised`, BOT).reason, 'he apologised');
  const byName = parseMuteIntent('sonder unmute kai', BOT);
  assert.strictEqual(byName.kind, 'unmute');
  assert.strictEqual(byName.targetName, 'kai');
  assert.strictEqual(parseMuteIntent(`sonder untimeout ${T(111)}`, BOT).kind, 'unmute');
});

test('unmute questions and mute are not confused', () => {
  assert.strictEqual(parseMuteIntent('sonder how do i unmute someone', BOT), null);
  assert.strictEqual(parseMuteIntent(`sonder can you unmute ${T(111)}?`, BOT), null);
  assert.strictEqual(parseMuteIntent('sonder unmute', BOT), null);
  assert.strictEqual(parseMuteIntent(`sonder mute ${T(111)} 5m`, BOT).kind, 'mute');
});

test('warn and kick are parsed with target and reason', () => {
  const w = parseMuteIntent(`sonder warn ${T(111)} for spamming links`, BOT);
  assert.strictEqual(w.kind, 'warn');
  assert.deepStrictEqual(w.targetIds, ['111']);
  assert.strictEqual(w.reason, 'spamming links');
  const k = parseMuteIntent('yo sonder kick kai because raiding', BOT);
  assert.strictEqual(k.kind, 'kick');
  assert.strictEqual(k.targetName, 'kai');
  assert.strictEqual(k.reason, 'raiding');
});

test('warn/kick chatter and questions never become actions', () => {
  for (const s of [
    'sonder kick off the event at 8',      // "kick off", not a person
    'sonder how do i kick someone',
    `sonder can you kick ${T(111)}?`,
    'sonder warn me before it starts',
    'sonder kick',
    'sonder warn',
    `sonder what does kick do`,
  ]) assert.strictEqual(parseMuteIntent(s, BOT), null, s);
});

test('only the first action verb in a message is used', () => {
  assert.strictEqual(parseMuteIntent(`sonder kick ${T(111)}, he should have been muted`, BOT).kind, 'kick');
  assert.strictEqual(parseMuteIntent(`sonder mute ${T(111)} then kick him later`, BOT).kind, 'mute');
});

test('a bare action verb gets a fixed usage hint, never a made-up target', () => {
  for (const [input, word] of [['sonder kick', 'kick'], ['yo sonder mute', 'mute'], ['sonder please warn', 'warn'], ['SONDER UNMUTE', 'unmute']]) {
    const h = usageHint(input);
    assert.ok(h && h.includes(word), input);
    assert.ok(h.includes('@someone'), input);
    assert.ok(!/kai/i.test(h), 'hint must not contain a real-looking name');
  }
});

test('normal chat and real requests are not hijacked by the hint', () => {
  for (const s of ['sonder kick off the event at 8', 'sonder what time is it', 'sonder how are you', 'sonder', `sonder kick ${T(111)}`]) {
    assert.strictEqual(usageHint(s), null, s);
  }
});

test('hint treats only the bot mention as noise', () => {
  assert.ok(usageHint(`<@${BOT}> kick`, BOT));
  assert.strictEqual(usageHint(`<@${BOT}> kick ${T(111)}`, BOT), null);
});

test('sliding window allows up to max, then blocks, then frees up', () => {
  const { windowOk } = require('../src/ai/actions')._limits;
  const map = new Map();
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i++) assert.strictEqual(windowOk(map, 'k', 3, t0 + i), true);
  assert.strictEqual(windowOk(map, 'k', 3, t0 + 10), false);
  assert.strictEqual(windowOk(map, 'other', 3, t0 + 10), true);          // keys are independent
  assert.strictEqual(windowOk(map, 'k', 3, t0 + 10 * 60 * 1000 + 5), true); // window passed
});

test('a person has a smaller allowance than the server', () => {
  const { USER_RATE_MAX, RATE_MAX } = require('../src/ai/actions')._limits;
  assert.ok(USER_RATE_MAX < RATE_MAX);
});
