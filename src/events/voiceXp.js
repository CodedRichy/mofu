const { Events } = require('discord.js');

// Voice XP: every minute, members talking with at least one other person earn XP (servers opt in with
// /leveling voice). A member is paid only when they were also eligible on the previous sweep, so channel-hopping
// in just before a tick earns nothing. The only state is `seen`, rebuilt from scratch on every sweep: anyone who
// left (or a whole guild the bot left) drops out on the next tick, and a restart starts empty. No leak.

const SWEEP_MS = 60000;
let seen = new Map(); // `${guildId}:${userId}` -> channelId at the last sweep
let timer = null;
let caseTimer = null;
let running = false;

// Only load what was not injected (tests pass a fake store so the real database is never opened).
function lazy(deps) {
  return {
    store: deps.store || require('../database/store'),
    xp: deps.xp || require('../utils/xp'),
    log: deps.log || require('../utils/logger'),
  };
}

// One pass over every guild. `deps` lets tests inject a fake store / xp module.
async function sweep(client, deps = {}) {
  if (running) return; // a slow sweep (rate-limited role grants) never overlaps the next one
  running = true;
  const { store, xp, log } = lazy(deps);
  const next = new Map();
  try {
    for (const guild of client.guilds.cache.values()) {
      if (store.getConfig(guild.id, 'voicexp_enabled') !== true) continue;
      if ((store.getConfig(guild.id, 'leveling') ?? true) === false) continue;
      const rate = xp.voiceRate(store.getConfig(guild.id, 'voicexp_rate'));

      const byChannel = new Map();
      for (const vs of guild.voiceStates.cache.values()) {
        if (!vs.channelId) continue;
        if (!byChannel.has(vs.channelId)) byChannel.set(vs.channelId, []);
        byChannel.get(vs.channelId).push(vs);
      }

      for (const [channelId, states] of byChannel) {
        const members = xp.eligibleVoiceMembers(states, { afkChannelId: guild.afkChannelId });
        if (!members.length) continue;
        const channel = guild.channels.cache.get(channelId) || { id: channelId };
        for (const member of members) {
          const key = `${guild.id}:${member.id}`;
          next.set(key, channelId);
          if (!seen.has(key)) continue; // first minute: just start the clock
          try {
            await xp.awardXp({ member, channel, base: rate, fallback: null }, deps);
          } catch (err) {
            log.warn(`Voice XP failed in ${guild.id}:`, err?.message || err);
          }
        }
      }
    }
  } catch (err) {
    log.warn('Voice XP sweep failed:', err?.message || err);
  } finally {
    seen = next;
    running = false;
  }
}

function start(client) {
  if (timer) return;
  timer = setInterval(() => { sweep(client).catch(() => {}); }, SWEEP_MS);
  timer.unref(); // never keeps the process alive on shutdown
  startCaseSweep(client);
}

// Housekeeping for the voice case file: forget idle channel buffers and lift expired voice bans. Runs even when
// voice XP is off, so it has its own timer.
function startCaseSweep(client) {
  if (caseTimer) return;
  caseTimer = setInterval(() => {
    try {
      const voicecase = require('../utils/voicecase');
      voicecase.buffer.prune();
      voicecase.sweepVoiceBans(client).catch(() => {});
    } catch { /* housekeeping only */ }
  }, SWEEP_MS);
  caseTimer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  if (caseTimer) clearInterval(caseTimer);
  caseTimer = null;
  seen = new Map();
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) { start(client); },
  // exposed for tests
  sweep, start, stop, _seenSize: () => seen.size,
};
