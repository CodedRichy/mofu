const test = require('node:test');
const assert = require('node:assert');
const { providerOrder, runChain, getProviderStatus } = require('../src/utils/ai');

const both = { groq: true, gemini: true };

test('chat order: groq default ends on gpt-oss, gemini in the middle', () => {
  assert.deepStrictEqual(providerOrder('chat', 'groq', both), ['groq-chat', 'gemini', 'groq-small']);
});
test('chat order: gemini and auto lead with gemini and still end on gpt-oss', () => {
  for (const m of ['gemini', 'auto']) {
    const o = providerOrder('chat', m, both);
    assert.strictEqual(o[0], 'gemini');
    assert.strictEqual(o[o.length - 1], 'groq-small');
  }
});
test('mod order: gpt-oss first by default, gemini only as fallback', () => {
  assert.deepStrictEqual(providerOrder('mod', 'groq', both), ['groq-small', 'gemini']);
  assert.deepStrictEqual(providerOrder('mod', 'auto', both), ['groq-small', 'gemini']);
  assert.deepStrictEqual(providerOrder('mod', 'gemini', both), ['gemini', 'groq-small']);
});
test('unavailable providers are dropped', () => {
  assert.deepStrictEqual(providerOrder('chat', 'groq', { groq: true, gemini: false }), ['groq-chat', 'groq-small']);
  assert.deepStrictEqual(providerOrder('chat', 'gemini', { groq: false, gemini: true }), ['gemini']);
  assert.deepStrictEqual(providerOrder('chat', 'auto', { groq: false, gemini: false }), []);
});

test('runChain returns first non-empty answer and stops', async () => {
  const calls = [];
  const mk = (name, v) => ({ name, call: async () => { calls.push(name); return v; } });
  const out = await runChain([mk('a', null), mk('b', '  '), mk('c', 'hi'), mk('d', 'no')]);
  assert.strictEqual(out, 'hi');
  assert.deepStrictEqual(calls, ['a', 'b', 'c']);
});
test('runChain survives a throwing provider and falls through', async () => {
  const out = await runChain([
    { name: 'bad', call: async () => { throw new Error('boom'); } },
    { name: 'ok', call: async () => 'fine' },
  ]);
  assert.strictEqual(out, 'fine');
});
test('runChain returns null when everything fails or the chain is empty', async () => {
  assert.strictEqual(await runChain([{ name: 'x', call: async () => null }]), null);
  assert.strictEqual(await runChain([]), null);
});

test('provider status exposes booleans and modes only', () => {
  const s = getProviderStatus();
  assert.strictEqual(typeof s.groq, 'boolean');
  assert.strictEqual(typeof s.gemini, 'boolean');
  assert.ok(['groq', 'gemini', 'auto'].includes(s.chatProvider));
  assert.ok(!/key|token|secret/i.test(Object.keys(s).join(',')));
});
