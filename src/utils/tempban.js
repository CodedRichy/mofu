// Tempban expiry. The table is the source of truth (survives restarts, no setTimeout 2^31 ms ceiling): a 15s sweep
// unbans every due row, logs an 'unban' case, and backs off on failures instead of hammering the API.

const MAX_ATTEMPTS = 12;
const SWEEP_MS = 15000;

// 1m, 2m, 4m ... capped at 6h
function backoffMs(attempts) {
  return Math.min(60000 * 2 ** Math.max(0, attempts - 1), 6 * 3600000);
}

// deps (for tests): { infractions, modlog, log, now }
async function expireDue(client, deps = {}) {
  const infractions = deps.infractions || require('../database/infractions');
  const modlog = deps.modlog || require('./modlog');
  const log = deps.log || require('./logger');
  const now = deps.now ?? Date.now();
  const results = [];

  for (const t of infractions.dueTempbans(now)) {
    // Another shard owns guilds missing from this cache; leave the row for it (or for the retention purge).
    const guild = client.guilds.cache.get(t.guild_id);
    if (!guild) continue;
    const reason = `Tempban expired${t.case_id ? ` (case #${t.case_id})` : ''}`;
    try {
      await guild.members.unban(t.user_id, reason);
    } catch (err) {
      if (err?.code === 10026) { // Unknown Ban: someone already unbanned them by hand
        infractions.removeTempban(t.guild_id, t.user_id, t.expires_at);
        results.push({ userId: t.user_id, outcome: 'already-unbanned' });
        continue;
      }
      const attempts = (t.attempts || 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        infractions.removeTempban(t.guild_id, t.user_id, t.expires_at);
        log.warn(`tempban: gave up unbanning ${t.user_id} in ${t.guild_id} after ${attempts} tries: ${err?.message}`);
        results.push({ userId: t.user_id, outcome: 'gave-up' });
      } else {
        infractions.deferTempban(t.guild_id, t.user_id, t.expires_at, attempts, now + backoffMs(attempts));
        results.push({ userId: t.user_id, outcome: 'retry' });
      }
      continue;
    }

    infractions.removeTempban(t.guild_id, t.user_id, t.expires_at);
    const user = await client.users.fetch(t.user_id).catch(() => null)
      || { id: t.user_id, tag: t.user_tag || t.user_id, displayAvatarURL: () => null };
    await modlog.send(guild, { action: 'unban', target: user, moderator: client.user, reason }).catch(() => {});
    results.push({ userId: t.user_id, outcome: 'unbanned' });
  }
  return results;
}

function startSweep(client) {
  let running = false;
  const run = async () => {
    if (running) return; // a slow sweep (rate limits) must not overlap the next tick
    running = true;
    try { await expireDue(client); } catch { /* next tick retries */ } finally { running = false; }
  };
  run();
  return setInterval(run, SWEEP_MS).unref();
}

module.exports = { expireDue, startSweep, backoffMs, MAX_ATTEMPTS };
