// Spend ceiling for Groq calls. Token buckets, checked before every request:
//   - global:            AI_GLOBAL_PER_MIN       (default 300) - protects the account / bill as a whole
//   - per guild, per kind: AI_GUILD_MOD_PER_MIN  (default 30)  - automod classifier calls
//                          AI_GUILD_CHAT_PER_MIN (default 20)  - chat, /ask, /summarize, ...
//   - per guild daily:   AI_GUILD_PER_DAY        (default 3000) - caps one server's total cost per day
// A guild bucket is checked before the global one and refunded if the global one says no, so a busy server
// spends only its own allowance and can never drain the shared pool past its per-minute slice. The defaults
// mean one server can use at most 30+20 of the 300 global requests per minute.
//
// Denied means "no AI this time": callers already treat a null reply as "do nothing", so a throttled
// automod check never punishes anyone.
const log = require('./logger');

function envInt(env, name, def, min, max) {
  const n = Number.parseInt(env[name], 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

class TokenBucket {
  // capacity tokens, refilled continuously at capacity per periodMs.
  constructor(capacity, periodMs, now) {
    this.capacity = capacity;
    this.rate = capacity / periodMs;
    this.tokens = capacity;
    this.at = now;
  }
  refill(now) {
    if (now > this.at) {
      this.tokens = Math.min(this.capacity, this.tokens + (now - this.at) * this.rate);
      this.at = now;
    }
  }
  take(now, n = 1) {
    this.refill(now);
    if (this.tokens >= n) { this.tokens -= n; return true; }
    return false;
  }
  give(n = 1) { this.tokens = Math.min(this.capacity, this.tokens + n); }
  full(now) { this.refill(now); return this.tokens >= this.capacity; }
}

function createBudget({ env = process.env, now = () => Date.now(), logger = log } = {}) {
  const limits = {
    global: envInt(env, 'AI_GLOBAL_PER_MIN', 300, 0, 100000),
    mod: envInt(env, 'AI_GUILD_MOD_PER_MIN', 30, 0, 10000),
    chat: envInt(env, 'AI_GUILD_CHAT_PER_MIN', 20, 0, 10000),
    day: envInt(env, 'AI_GUILD_PER_DAY', 3000, 0, 1000000),
  };
  const MIN = 60000;
  const DAY = 86400000;
  const globalBucket = new TokenBucket(limits.global, MIN, now());
  const buckets = new Map(); // `${scope}|${kind}` and `${scope}|day` -> TokenBucket
  const lastWarn = new Map(); // throttles the warning to once a minute per scope+reason
  let lastSweep = now();
  const stats = { allowed: 0, denied: 0 };

  function bucket(key, capacity, period, t) {
    let b = buckets.get(key);
    if (!b) { b = new TokenBucket(capacity, period, t); buckets.set(key, b); }
    return b;
  }

  // Full buckets carry no state, so they can be dropped; keeps the map at "servers active recently".
  function sweep(t) {
    if (t - lastSweep < MIN) return;
    lastSweep = t;
    for (const [k, b] of buckets) if (b.full(t)) buckets.delete(k);
    for (const [k, at] of lastWarn) if (t - at > MIN) lastWarn.delete(k);
  }

  function warn(scope, reason, t) {
    const k = `${scope}|${reason}`;
    if (lastWarn.has(k) && t - lastWarn.get(k) < MIN) return;
    lastWarn.set(k, t);
    logger.warn(`AI budget: ${reason} limit hit for ${scope}; skipping AI calls (no action taken)`);
  }

  // scope: a guild id, or a label like 'web' / 'dm'. kind: 'mod' | 'chat'.
  function tryAcquire(scope, kind = 'chat') {
    const t = now();
    sweep(t);
    const s = String(scope || 'none').slice(0, 64);
    const k = kind === 'mod' ? 'mod' : 'chat';
    const minute = bucket(`${s}|${k}`, limits[k], MIN, t);
    if (!minute.take(t)) { stats.denied++; warn(s, `per-guild ${k}`, t); return false; }
    const day = bucket(`${s}|day`, limits.day, DAY, t);
    if (!day.take(t)) { minute.give(); stats.denied++; warn(s, 'per-guild daily', t); return false; }
    if (!globalBucket.take(t)) { minute.give(); day.give(); stats.denied++; warn('all servers', 'global', t); return false; }
    stats.allowed++;
    return true;
  }

  return { tryAcquire, limits, stats, _buckets: buckets };
}

module.exports = { createBudget, TokenBucket };
