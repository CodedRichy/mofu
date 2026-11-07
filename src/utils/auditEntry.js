// Finding WHO did something from the audit log, reliably.
//
// Discord writes the audit entry slightly after it fires the gateway event, and during a mass action the newest
// entry is not necessarily the one for this event. Taking `entries.first()` therefore misses the actor (entry
// not written yet) or blames the wrong one (another action landed in between). Instead: look at the last few
// entries, take the one that is about THIS target and is recent, and retry briefly if it is not there yet.
const MAX_AGE_MS = 15000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pure matcher, kept separate so it can be tested without Discord.
// entries: array of { target?: { id }, executor?: { id }, createdTimestamp }
function pickEntry(entries, targetId, now = Date.now(), maxAgeMs = MAX_AGE_MS) {
  let best = null;
  for (const e of entries) {
    if (!e || !e.executor) continue;
    if (targetId && e.target?.id !== targetId) continue;
    if (now - e.createdTimestamp > maxAgeMs) continue;
    if (!best || e.createdTimestamp > best.createdTimestamp) best = e;
  }
  return best;
}

async function findAuditEntry(guild, type, targetId, { tries = 3, delayMs = 600 } = {}) {
  for (let i = 0; i < tries; i++) {
    const logs = await guild.fetchAuditLogs({ type, limit: 10 }).catch(() => null);
    if (logs) {
      const hit = pickEntry([...logs.entries.values()], targetId);
      if (hit) return hit;
    }
    if (i < tries - 1) await sleep(delayMs);
  }
  return null;
}

// Strip roles and ban an offender even when they are not in the member cache. The ban works on a bare user id,
// so a cache miss can never let the attacker keep going.
// Returns what actually happened so the modlog never claims a ban or strip that Discord refused.
// rolesStripped is null when the executor was not in the server (nothing to strip).
async function punishExecutor(guild, executorId, reason) {
  const member = guild.members.cache.get(executorId) || await guild.members.fetch(executorId).catch(() => null);
  let rolesStripped = null;
  if (member) rolesStripped = await member.roles.set([], reason).then(() => true, () => false);
  const banned = await guild.members.ban(executorId, { reason }).then(() => true, () => false);
  return { banned, rolesStripped };
}

// "**Ban** done\n**Roles stripped** failed\n**Restored** done", built from step results.
// steps: array of [label, true | false | null]; null steps are skipped. Capped well under the 4096 embed limit.
function stepLines(steps) {
  const out = steps
    .filter(([, ok]) => ok !== null && ok !== undefined)
    .map(([label, ok]) => `**${label}** ${ok ? 'done' : 'failed (check my permissions and role position)'}`)
    .join('\n');
  return out.length > 1500 ? `${out.slice(0, 1497)}...` : out;
}

module.exports = { findAuditEntry, pickEntry, punishExecutor, stepLines, MAX_AGE_MS };
