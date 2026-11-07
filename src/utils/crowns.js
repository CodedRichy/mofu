// Pure logic for `fm whoknows` and crowns. No network, no Discord, no database: callers inject data and fetchers.
//
// A crown belongs to the member with the most plays of an artist among the linked members that were checked
// for that lookup. Crowns therefore only exist for artists someone looked up (or that were in the invoker's top
// artists when crowns were refreshed), and only reflect the members that were checked.

const LOOKUP_CAP = 25;              // linked members checked per lookup (rate limit protection)
const CACHE_TTL_MS = 10 * 60 * 1000; // whoknows results are reused for this long
const MIN_CROWN_PLAYS = 5;          // below this a top listener is not treated as a crown holder
const MAX_CROWNS = 500;             // stored crowns per server
const CONCURRENCY = 5;

const artistKey = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');

// The most recently active members first; members with no activity record sort last. Ties break on id so the
// choice is stable. Hidden members are dropped here, before any lookup is made.
function pickLookupTargets(members, { cap = LOOKUP_CAP, isPresent = () => true } = {}) {
  return members
    .filter((m) => !m.hidden && isPresent(m.userId))
    .slice()
    .sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0) || (a.userId < b.userId ? -1 : 1))
    .slice(0, Math.max(0, cap));
}

// entries: [{ userId, username, plays }] -> descending by plays, zero-play members removed.
function rankListeners(entries) {
  return entries
    .filter((e) => Number.isFinite(e.plays) && e.plays > 0)
    .slice()
    .sort((a, b) => b.plays - a.plays || (a.userId < b.userId ? -1 : 1));
}

// Run fetchOne(member) over targets with limited concurrency. Stops starting new lookups once one throws a
// Last.fm "unavailable" error and reports the partial result instead of failing the whole command.
// Returns { entries, checked, failed, aborted }.
async function collectPlays(targets, fetchOne, { concurrency = CONCURRENCY } = {}) {
  const entries = [];
  let checked = 0;
  let failed = 0;
  let aborted = false;
  let next = 0;
  async function worker() {
    while (!aborted) {
      const i = next++;
      if (i >= targets.length) return;
      const m = targets[i];
      try {
        const info = await fetchOne(m);
        checked++;
        if (info) entries.push({ userId: m.userId, username: m.username, plays: Number(info.plays) || 0, artist: info.artist || null });
      } catch (err) {
        if (err?.code === 'LASTFM_UNAVAILABLE') aborted = true;
        else failed++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, targets.length || 1)) }, worker));
  return { entries, checked, failed, aborted };
}

// TTL cache keyed by guild + artist. `now` is injectable for tests.
function createCache({ ttl = CACHE_TTL_MS, now = Date.now } = {}) {
  const map = new Map();
  const k = (guildId, artist) => `${guildId}\u0000${artistKey(artist)}`;
  return {
    get(guildId, artist) {
      const hit = map.get(k(guildId, artist));
      if (!hit) return null;
      if (now() - hit.at >= ttl) { map.delete(k(guildId, artist)); return null; }
      return hit.value;
    },
    set(guildId, artist, value) {
      map.set(k(guildId, artist), { at: now(), value });
    },
    clearGuild(guildId) {
      const prefix = `${guildId}\u0000`;
      for (const key of map.keys()) if (key.startsWith(prefix)) map.delete(key);
    },
    size: () => map.size,
  };
}

// Fold one lookup into the stored crowns map. Returns a new map.
// ranking: output of rankListeners; the crown goes to ranking[0] if it clears MIN_CROWN_PLAYS.
function applyLookup(crowns, artist, ranking, { now = Date.now(), minPlays = MIN_CROWN_PLAYS, max = MAX_CROWNS } = {}) {
  const out = { ...crowns };
  const key = artistKey(artist);
  const top = ranking[0];
  if (!key) return out;
  if (!top || top.plays < minPlays) {
    delete out[key];
    return out;
  }
  out[key] = { a: String(artist), u: top.userId, p: top.plays, t: now };
  const keys = Object.keys(out);
  if (keys.length > max) {
    // drop the oldest lookups first
    keys.sort((x, y) => (out[x].t || 0) - (out[y].t || 0));
    for (const old of keys.slice(0, keys.length - max)) delete out[old];
  }
  return out;
}

// Remove crowns held by members who no longer count (hid from rankings, left the server).
function dropHolders(crowns, shouldDrop) {
  const out = {};
  for (const [k, c] of Object.entries(crowns)) if (!shouldDrop(c.u)) out[k] = c;
  return out;
}

function crownsOf(crowns, userId) {
  return Object.values(crowns).filter((c) => c.u === userId).sort((a, b) => b.p - a.p || (a.a < b.a ? -1 : 1));
}

// Member -> crown count, sorted. Ties: more total plays across their crowns, then lower id.
function leaderboard(crowns) {
  const by = new Map();
  for (const c of Object.values(crowns)) {
    const cur = by.get(c.u) || { userId: c.u, count: 0, plays: 0 };
    cur.count++;
    cur.plays += c.p || 0;
    by.set(c.u, cur);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || b.plays - a.plays || (a.userId < b.userId ? -1 : 1));
}

// The single member who gets the crown role, or null when nobody holds a crown.
function crownRoleHolder(crowns) {
  return leaderboard(crowns)[0]?.userId || null;
}

module.exports = {
  LOOKUP_CAP, CACHE_TTL_MS, MIN_CROWN_PLAYS, MAX_CROWNS,
  artistKey, pickLookupTargets, rankListeners, collectPlays, createCache,
  applyLookup, dropHolders, crownsOf, leaderboard, crownRoleHolder,
};
