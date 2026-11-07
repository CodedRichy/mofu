const test = require('node:test');
const assert = require('node:assert');
const { createBudget } = require('../src/utils/aiBudget');

function make(env = {}) {
  const clock = { t: 0 };
  const warnings = [];
  const b = createBudget({ env, now: () => clock.t, logger: { warn: (m) => warnings.push(m) } });
  return { b, clock, warnings };
}

test('defaults are sane and env-tunable with clamping', () => {
  assert.deepEqual(make().b.limits, { global: 300, mod: 30, chat: 20, day: 3000 });
  const { b } = make({ AI_GLOBAL_PER_MIN: '50', AI_GUILD_CHAT_PER_MIN: 'abc', AI_GUILD_MOD_PER_MIN: '-5' });
  assert.equal(b.limits.global, 50);
  assert.equal(b.limits.chat, 20); // junk falls back to default
  assert.equal(b.limits.mod, 0); // clamped at 0 = AI off for that kind
});

test('per-guild limit stops one server, and it refills over time', () => {
  const { b, clock } = make({ AI_GUILD_CHAT_PER_MIN: '3' });
  assert.equal(b.tryAcquire('g1', 'chat'), true);
  assert.equal(b.tryAcquire('g1', 'chat'), true);
  assert.equal(b.tryAcquire('g1', 'chat'), true);
  assert.equal(b.tryAcquire('g1', 'chat'), false);
  clock.t += 20000; // a third of a minute = one token at 3/min
  assert.equal(b.tryAcquire('g1', 'chat'), true);
  assert.equal(b.tryAcquire('g1', 'chat'), false);
});

test('a noisy server cannot starve others', () => {
  const { b } = make({ AI_GLOBAL_PER_MIN: '10', AI_GUILD_CHAT_PER_MIN: '4' });
  let noisy = 0;
  for (let i = 0; i < 100; i++) if (b.tryAcquire('noisy', 'chat')) noisy++;
  assert.equal(noisy, 4);
  // the shared pool still has room for everyone else
  assert.equal(b.tryAcquire('quiet1', 'chat'), true);
  assert.equal(b.tryAcquire('quiet2', 'chat'), true);
});

test('automod and chat have separate per-guild buckets', () => {
  const { b } = make({ AI_GUILD_MOD_PER_MIN: '2', AI_GUILD_CHAT_PER_MIN: '2' });
  assert.equal(b.tryAcquire('g', 'mod'), true);
  assert.equal(b.tryAcquire('g', 'mod'), true);
  assert.equal(b.tryAcquire('g', 'mod'), false);
  assert.equal(b.tryAcquire('g', 'chat'), true, 'a flood of automod checks does not silence chat');
});

test('global ceiling holds and a denied global call refunds the guild token', () => {
  const { b } = make({ AI_GLOBAL_PER_MIN: '3', AI_GUILD_CHAT_PER_MIN: '2' });
  assert.equal(b.tryAcquire('a'), true);
  assert.equal(b.tryAcquire('b'), true);
  assert.equal(b.tryAcquire('c'), true);
  assert.equal(b.tryAcquire('d'), false); // global empty
  // d was refunded: its own bucket is still full
  assert.equal(b._buckets.get('d|chat').tokens, 2);
});

test('daily cap per guild', () => {
  const { b, clock } = make({ AI_GUILD_PER_DAY: '5', AI_GUILD_CHAT_PER_MIN: '100', AI_GLOBAL_PER_MIN: '1000' });
  let n = 0;
  for (let i = 0; i < 50; i++) { clock.t += 1000; if (b.tryAcquire('g')) n++; }
  assert.equal(n, 5);
});

test('warnings are throttled to one per minute per scope', () => {
  const { b, clock, warnings } = make({ AI_GUILD_CHAT_PER_MIN: '1' });
  b.tryAcquire('g');
  for (let i = 0; i < 20; i++) b.tryAcquire('g');
  assert.equal(warnings.length, 1);
  assert.ok(/no action taken/.test(warnings[0]));
  clock.t += 61000;
  b.tryAcquire('g'); b.tryAcquire('g');
  assert.equal(warnings.length, 2);
});

test('idle full buckets are swept so memory tracks active servers only', () => {
  const { b, clock } = make();
  for (let i = 0; i < 500; i++) b.tryAcquire(`g${i}`);
  assert.ok(b._buckets.size >= 500);
  clock.t += 2 * 86400000;
  b.tryAcquire('fresh');
  assert.ok(b._buckets.size <= 2);
});

test('moderation parsing fails closed: only an explicit flagged:true counts', () => {
  const { parseModeration } = require('../src/utils/ai');
  assert.deepEqual(parseModeration(null), { flagged: false });
  assert.deepEqual(parseModeration('not json'), { flagged: false });
  assert.deepEqual(parseModeration('{"flagged": "true"}'), { flagged: false });
  assert.deepEqual(parseModeration('{"flagged": 1}'), { flagged: false });
  assert.deepEqual(parseModeration('{"flagged": false, "reason": "x"}'), { flagged: false });
  assert.deepEqual(parseModeration('```json\n{"flagged": true, "reason": "spam"}\n```'), { flagged: true, reason: 'spam' });
  assert.equal(parseModeration(`{"flagged": true, "reason": "${'x'.repeat(500)}"}`).reason.length, 200);
});

test('over budget, moderate() returns not-flagged without calling the provider', async () => {
  const ai = require('../src/utils/ai');
  const config = require('../src/config');
  const saved = config.groq.apiKey;
  const realFetch = global.fetch;
  let calls = 0;
  global.fetch = () => { calls++; return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: '{"flagged": true}' } }] }))); };
  config.groq.apiKey = 'test-key';
  try {
    const g = 'budget-test-guild';
    let flagged = 0;
    for (let i = 0; i < ai.budget.limits.mod + 5; i++) if ((await ai.moderate('hello there friend', { guildId: g })).flagged) flagged++;
    assert.equal(calls, ai.budget.limits.mod, 'provider called only within budget');
    assert.equal(flagged, ai.budget.limits.mod, 'throttled checks are never flagged');
  } finally {
    global.fetch = realFetch;
    config.groq.apiKey = saved;
  }
});
