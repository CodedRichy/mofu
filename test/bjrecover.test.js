const test = require('node:test');
const assert = require('node:assert');
const store = require('../src/database/store');
const { recoverOpenBets } = require('../src/utils/bjRecover');

const G = 'bjrec-guild-' + Date.now();
test.after(() => {
  store.db.prepare('DELETE FROM economy WHERE guild_id = ?').run(G);
  store.db.prepare('DELETE FROM config WHERE guild_id = ?').run(G);
  store.clearConfigCache(G);
});

test('interrupted blackjack hands are refunded once and cleared', () => {
  const before = store.getBalance(G, 'u1').wallet;
  store.setConfig(G, 'bj_open_u1', 250);
  assert.equal(recoverOpenBets(G), 1);
  assert.equal(store.getBalance(G, 'u1').wallet, before + 250);
  assert.equal(recoverOpenBets(G), 0);
  assert.equal(store.getBalance(G, 'u1').wallet, before + 250);
});
