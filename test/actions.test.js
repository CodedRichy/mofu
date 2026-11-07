const test = require('node:test');
const assert = require('node:assert');
const { parseMuteIntent, usageHint } = require('../src/ai/actions');
const { parse, format } = require('../src/utils/duration');
const { BRAND, TRIGGER_WORDS } = require('../src/utils/constants');

const BOT = '999';
const T = (id) => `<@${id}>`;

test('the bot answers to its new name and its old one', () => {
  assert.strictEqual(BRAND, 'mofu');
  assert.deepStrictEqual([...TRIGGER_WORDS], ['mofu', 'sonder']);
});

// Every parser test runs once per trigger word: the new name 'mofu' and the old name 'sonder'.
for (const N of TRIGGER_WORDS) {
  const UP = N.toUpperCase();

  test(`[${N}] mute with mention, duration and reason`, () => {
    const r = parseMuteIntent(`${N} mute ${T(111)} 10m for spamming`, BOT);
    assert.deepStrictEqual(r.targetIds, ['111']);
    assert.strictEqual(r.duration, '10m');
    assert.strictEqual(r.reason, 'spamming');
  });

  test(`[${N}] defaults to 30m and no reason`, () => {
    const r = parseMuteIntent(`yo ${N} mute ${T(111)}`, BOT);
    assert.strictEqual(r.duration, '30m');
    assert.strictEqual(r.reason, 'No reason provided');
  });

  test(`[${N}] typed name target`, () => {
    const r = parseMuteIntent(`${UP} MUTE KAI 30S`, BOT);
    assert.strictEqual(r.targetName, 'KAI');
    assert.strictEqual(r.duration, '30s');
  });

  test(`[${N}] questions and chatter are not actions`, () => {
    for (const s of [`${N} how do i mute someone`, `${N} what happens if i mute ${T(111)}?`, `${N} mute`, `${N} mute him`, `${N} can i mute people here`, `${T(BOT)} mute ${T(BOT)}`]) {
      assert.strictEqual(parseMuteIntent(s, BOT), null, s);
    }
  });

  test(`[${N}] @everyone is stripped from reasons`, () => {
    const r = parseMuteIntent(`hey ${N} mute ${T(111)} 1d cuz raiding @everyone`, BOT);
    assert.strictEqual(r.reason, 'raiding');
  });

  test(`[${N}] unmute is parsed as its own action, not a mute`, () => {
    const r = parseMuteIntent(`${N} unmute ${T(111)}`, BOT);
    assert.strictEqual(r.kind, 'unmute');
    assert.deepStrictEqual(r.targetIds, ['111']);
    assert.strictEqual(parseMuteIntent(`yo ${N} un mute ${T(111)} cuz he apologised`, BOT).reason, 'he apologised');
    const byName = parseMuteIntent(`${N} unmute kai`, BOT);
    assert.strictEqual(byName.kind, 'unmute');
    assert.strictEqual(byName.targetName, 'kai');
    assert.strictEqual(parseMuteIntent(`${N} untimeout ${T(111)}`, BOT).kind, 'unmute');
  });

  test(`[${N}] unmute questions and mute are not confused`, () => {
    assert.strictEqual(parseMuteIntent(`${N} how do i unmute someone`, BOT), null);
    assert.strictEqual(parseMuteIntent(`${N} can you unmute ${T(111)}?`, BOT), null);
    assert.strictEqual(parseMuteIntent(`${N} unmute`, BOT), null);
    assert.strictEqual(parseMuteIntent(`${N} mute ${T(111)} 5m`, BOT).kind, 'mute');
  });

  test(`[${N}] warn and kick are parsed with target and reason`, () => {
    const w = parseMuteIntent(`${N} warn ${T(111)} for spamming links`, BOT);
    assert.strictEqual(w.kind, 'warn');
    assert.deepStrictEqual(w.targetIds, ['111']);
    assert.strictEqual(w.reason, 'spamming links');
    const k = parseMuteIntent(`yo ${N} kick kai because raiding`, BOT);
    assert.strictEqual(k.kind, 'kick');
    assert.strictEqual(k.targetName, 'kai');
    assert.strictEqual(k.reason, 'raiding');
  });

  test(`[${N}] warn/kick chatter and questions never become actions`, () => {
    for (const s of [
      `${N} kick off the event at 8`,      // "kick off", not a person
      `${N} how do i kick someone`,
      `${N} can you kick ${T(111)}?`,
      `${N} warn me before it starts`,
      `${N} kick`,
      `${N} warn`,
      `${N} what does kick do`,
      `the ${N} mute button is broken`,
    ]) assert.strictEqual(parseMuteIntent(s, BOT), null, s);
  });

  test(`[${N}] only the first action verb in a message is used`, () => {
    assert.strictEqual(parseMuteIntent(`${N} kick ${T(111)}, he should have been muted`, BOT).kind, 'kick');
    assert.strictEqual(parseMuteIntent(`${N} mute ${T(111)} then kick him later`, BOT).kind, 'mute');
  });

  test(`[${N}] a bare action verb gets a fixed usage hint, never a made-up target`, () => {
    for (const [input, word] of [[`${N} kick`, 'kick'], [`yo ${N} mute`, 'mute'], [`${N} please warn`, 'warn'], [`${UP} UNMUTE`, 'unmute']]) {
      const h = usageHint(input);
      assert.ok(h && h.includes(word), input);
      assert.ok(h.includes('@someone'), input);
      assert.ok(h.includes(`\`${BRAND} `), `hint shows the new name: ${input}`);
      assert.ok(!/kai/i.test(h), 'hint must not contain a real-looking name');
    }
  });

  test(`[${N}] normal chat and real requests are not hijacked by the hint`, () => {
    for (const s of [`${N} kick off the event at 8`, `${N} what time is it`, `${N} how are you`, N, `${N} kick ${T(111)}`]) {
      assert.strictEqual(usageHint(s), null, s);
    }
  });
}

test('duration parse/format', () => {
  assert.strictEqual(parse('30m'), 1800000);
  assert.strictEqual(parse('1h'), 3600000);
  assert.ok(!parse('abc'));
  assert.match(format(3600000), /1/);
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
