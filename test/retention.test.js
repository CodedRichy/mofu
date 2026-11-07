const test = require('node:test');
const assert = require('node:assert');
const store = require('../src/database/store');
const retention = require('../src/database/retention');

const G = 'test-guild-retention';
const OTHER = 'test-guild-retention-other';

test('purgeGuild removes one guild everywhere and leaves others alone', () => {
  for (const g of [G, OTHER]) {
    store.setConfig(g, 'prefix', '!');
    store.addWarning(g, 'u1', { moderator: 'm', reason: 'r' });
    store.addNote(g, 'u1', 'm', 'n');
  }
  assert.ok(retention.guildTables().includes('warnings'));
  const removed = retention.purgeGuild(G);
  assert.ok(removed >= 2);
  assert.strictEqual(store.getWarnings(G, 'u1').length, 0);
  assert.strictEqual(store.getWarnings(OTHER, 'u1').length, 1);
  retention.purgeGuild(OTHER);
});

test('markReturned cancels a pending deletion', () => {
  retention.markLeft(G);
  retention.markReturned(G);
  const row = store.db.prepare('SELECT 1 FROM guild_departures WHERE guild_id = ?').get(G);
  assert.strictEqual(row, undefined);
});

test('purge also clears cached config', () => {
  store.setConfig(G, 'prefix', '?');
  assert.strictEqual(store.getConfig(G, 'prefix'), '?');
  retention.purgeGuild(G);
  assert.strictEqual(store.getConfig(G, 'prefix'), null);
});
