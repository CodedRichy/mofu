// A restart wipes the in-memory blackjack hands, but the bet was already taken from the wallet. Each open hand is
// recorded as config key bj_open_<userId> (see commands/economy/blackjack.js); at startup nothing can still be
// playing, so every leftover is refunded once and cleared.
const store = require('../database/store');
const log = require('./logger');

// guildId narrows the sweep (tests use it so they never touch a live hand in the real database).
function recoverOpenBets(guildId) {
  let refunded = 0;
  try {
    const rows = guildId
      ? store.db.prepare("SELECT guild_id, key, value FROM config WHERE key LIKE 'bj_open_%' AND guild_id = ?").all(guildId)
      : store.db.prepare("SELECT guild_id, key, value FROM config WHERE key LIKE 'bj_open_%'").all();
    for (const row of rows) {
      const userId = row.key.slice('bj_open_'.length);
      let amount = 0;
      try { amount = Number(JSON.parse(row.value)); } catch { amount = Number(row.value); }
      if (Number.isFinite(amount) && amount > 0 && userId) {
        store.addWallet(row.guild_id, userId, Math.floor(amount));
        refunded += 1;
      }
      store.setConfig(row.guild_id, row.key, null);
    }
  } catch (err) {
    log.warn('blackjack recovery failed: ' + err.message);
  }
  if (refunded) log.info('Refunded ' + refunded + ' blackjack hand(s) interrupted by a restart');
  return refunded;
}

module.exports = { recoverOpenBets };
