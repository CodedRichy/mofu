const test = require('node:test');
const assert = require('node:assert');
const { detectBots, prefixClash, suggestChannels } = require('../src/utils/migrate');

test('detects known bots by name, once each', () => {
  const found = detectBots(['Greed', 'greed', 'MEE6', 'Random Bot', 'Carl-bot']);
  assert.deepStrictEqual(found.map((b) => b.name), ['Greed', 'MEE6', 'Carl-bot']);
});

test('prefix clash only on exact default match', () => {
  const bots = detectBots(['MEE6', 'Greed']);
  assert.deepStrictEqual(prefixClash('!', bots).map((b) => b.name), ['MEE6']);
  assert.deepStrictEqual(prefixClash(';', bots), []);
});

test('suggests existing log/welcome channels', () => {
  const s = suggestChannels([{ id: '1', name: 'general' }, { id: '2', name: 'mod-logs' }, { id: '3', name: '👋・welcome' }, { id: '4', name: 'goodbye' }]);
  assert.strictEqual(s.modlog_channel.id, '2');
  assert.strictEqual(s.welcome_channel.id, '3');
  assert.strictEqual(s.goodbye_channel.id, '4');
});

test('does not match unrelated channels', () => {
  assert.deepStrictEqual(suggestChannels([{ id: '1', name: 'general' }, { id: '2', name: 'welcome-rules-and-info' }]), {});
});
