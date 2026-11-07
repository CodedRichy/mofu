const test = require('node:test');
const assert = require('node:assert');
const r = require('../src/utils/automodRules');

const rule = (action, extra = {}) => ({ action, ...extra });

test('ladder climbs warn -> timeout -> top action and stops at the configured ceiling', () => {
  const kinds = (action) => [1, 2, 3, 4].map((n) => r.ladderStep(rule(action), n).kind);
  assert.deepStrictEqual(kinds('delete'), ['delete', 'delete', 'delete', 'delete']);
  assert.deepStrictEqual(kinds('warn'), ['warn', 'warn', 'warn', 'warn']);
  assert.deepStrictEqual(kinds('timeout'), ['warn', 'timeout', 'timeout', 'timeout']);
  assert.deepStrictEqual(kinds('kick'), ['warn', 'timeout', 'kick', 'kick']);
  assert.deepStrictEqual(kinds('ban'), ['warn', 'timeout', 'ban', 'ban']);
});

test('timeout length comes from the rule, defaults to 10 minutes', () => {
  assert.strictEqual(r.ladderStep(rule('timeout'), 2).ms, 10 * 60000);
  assert.strictEqual(r.ladderStep(rule('ban', { timeoutMin: 30 }), 2).ms, 30 * 60000);
});

test('garbage rules normalize to null or safe defaults', () => {
  assert.strictEqual(r.normalizeRule(null), null);
  assert.strictEqual(r.normalizeRule({ action: 'off' }), null);
  assert.strictEqual(r.normalizeRule({ action: 'nuke' }), null);
  assert.deepStrictEqual(r.normalizeRule({ action: 'KICK', timeoutMin: -5, windowMin: 99999 }), { action: 'kick', timeoutMin: 10, windowMin: 60 });
  assert.deepStrictEqual(Object.keys(r.normalizeRules({ links: { action: 'warn' }, bogus: { action: 'ban' }, caps: { action: 'off' } })), ['links']);
  assert.strictEqual(r.ladderStep(null, 5).kind, 'delete');
});

test('strike counter: rolling window, reset, TTL sweep and size cap', () => {
  let now = 0;
  const c = new r.StrikeCounter({ maxEntries: 3, now: () => now });
  assert.strictEqual(c.hit('a', 1000), 1);
  now = 500; assert.strictEqual(c.hit('a', 1000), 2);
  now = 1600; assert.strictEqual(c.hit('a', 1000), 1); // first two strikes aged out
  c.reset('a'); assert.strictEqual(c.hit('a', 1000), 1);
  c.hit('b', 1000); c.hit('c', 1000); c.hit('d', 1000);
  assert.strictEqual(c.size, 3); // oldest key evicted, never unbounded
  now = 10000; c.sweep();
  assert.strictEqual(c.size, 0);
});

test('per-key strike history is bounded', () => {
  const c = new r.StrikeCounter({ maxPerKey: 5, now: () => 1 });
  for (let i = 0; i < 50; i++) c.hit('k', 60000);
  assert.strictEqual(c.map.get('k').ts.length, 5);
});

test('detectors: invites, mass mentions, caps', () => {
  assert.ok(r.hasInvite('join discord.gg/abc123'));
  assert.ok(r.hasInvite('https://discord.com/invite/xyz'));
  assert.ok(!r.hasInvite('see notdiscord.gg.example.com and discord.com/channels/1/2'));
  assert.strictEqual(r.mentionCount('<@111111111111111111> <@!111111111111111111> <@&222222222222222222> @everyone'), 3);
  assert.ok(r.isMassMention('<@111111111111111111> <@111111111111111112> <@111111111111111113> <@111111111111111114> @here'));
  assert.ok(!r.isMassMention('<@111111111111111111> hi'));
  assert.ok(r.isCapsHeavy('WHY IS NOBODY ANSWERING ME'));
  assert.ok(!r.isCapsHeavy('LOL ok'));
  assert.ok(!r.isCapsHeavy('this is a normal sentence with NASA in it'));
  assert.ok(!r.isCapsHeavy('<@111111111111111111> https://EXAMPLE.COM/ABCDEFGHIJKLMNOP'));
});

test('describeRule is short text for /automod status', () => {
  assert.strictEqual(r.describeRule(rule('ban', { timeoutMin: 15, windowMin: 30 })), 'warn -> timeout 15m -> ban (window 30m)');
  assert.strictEqual(r.describeRule(null), 'off');
});
