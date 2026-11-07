// Automod rule ladder: pure logic, no database, no Discord calls, no AI. automod.js wires it to messages.
// A rule is { action, timeoutMin, windowMin }, stored per trigger in config 'automod_rules'.
// The ladder climbs with each strike inside the rolling window and stops at the rule's action:
//   delete  -> delete only, every time
//   warn    -> delete + warning, every time
//   timeout -> 1st: delete + warning, 2nd+: timeout
//   kick/ban-> 1st: delete + warning, 2nd: timeout, 3rd+: kick / ban

const TRIGGERS = ['spam', 'links', 'invites', 'caps', 'mentions', 'badwords'];
const ACTIONS = ['off', 'delete', 'warn', 'timeout', 'kick', 'ban'];
const LABELS = {
  spam: 'spam', links: 'links', invites: 'invite links', caps: 'excessive caps', mentions: 'mass mentions', badwords: 'blocked words',
};
const DEFAULT_TIMEOUT_MIN = 10;
const DEFAULT_WINDOW_MIN = 60;
const MAX_TIMEOUT_MIN = 40320; // 28 days, Discord's ceiling
const MAX_WINDOW_MIN = 1440; // 24h
const MENTION_LIMIT = 5;
const CAPS_MIN_LETTERS = 12;
const CAPS_RATIO = 0.7;
// Legacy /antispam burst detector (events/messageCreate.js). Embeds read these instead of hard-coding them.
const SPAM_THRESHOLD = 5;
const SPAM_WINDOW_MS = 3000;
const SPAM_TIMEOUT_MS = 60000;

const intIn = (v, lo, hi, dflt) => (Number.isInteger(v) && v >= lo && v <= hi ? v : dflt);

// A clean rule or null (off / garbage). Never throws.
function normalizeRule(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const action = String(raw.action || '').toLowerCase();
  if (!ACTIONS.includes(action) || action === 'off') return null;
  return {
    action,
    timeoutMin: intIn(raw.timeoutMin, 1, MAX_TIMEOUT_MIN, DEFAULT_TIMEOUT_MIN),
    windowMin: intIn(raw.windowMin, 1, MAX_WINDOW_MIN, DEFAULT_WINDOW_MIN),
  };
}

function normalizeRules(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const t of TRIGGERS) {
    const r = normalizeRule(raw[t]);
    if (r) out[t] = r;
  }
  return out;
}

// What strike number `strike` (1-based) of `rule` does. { kind: 'delete'|'warn'|'timeout'|'kick'|'ban', ms? }
function ladderStep(rule, strike) {
  const r = normalizeRule(rule);
  if (!r) return { kind: 'delete' };
  const n = Math.max(1, strike | 0);
  const timeout = { kind: 'timeout', ms: r.timeoutMin * 60000 };
  switch (r.action) {
    case 'delete': return { kind: 'delete' };
    case 'warn': return { kind: 'warn' };
    case 'timeout': return n === 1 ? { kind: 'warn' } : timeout;
    default: // kick | ban
      if (n === 1) return { kind: 'warn' };
      if (n === 2) return timeout;
      return { kind: r.action };
  }
}

function describeRule(rule) {
  const r = normalizeRule(rule);
  if (!r) return 'off';
  const t = `timeout ${r.timeoutMin}m`;
  const steps = {
    delete: 'delete',
    warn: 'delete + warn',
    timeout: `warn -> ${t}`,
    kick: `warn -> ${t} -> kick`,
    ban: `warn -> ${t} -> ban`,
  }[r.action];
  return `${steps} (window ${r.windowMin}m)`;
}

// --- detectors (content only, so edits are checked the same way) ---

const INVITE_RE = /(?:^|[^\w])(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/[\w-]+/i;
function hasInvite(content) { return INVITE_RE.test(String(content || '')); }

function mentionCount(content) {
  const s = String(content || '');
  const ids = new Set();
  for (const m of s.matchAll(/<@!?(\d{15,25})>|<@&(\d{15,25})>/g)) ids.add(m[1] ? `u${m[1]}` : `r${m[2]}`);
  const mass = (s.match(/@(?:everyone|here)\b/g) || []).length;
  return ids.size + mass;
}
function isMassMention(content, limit = MENTION_LIMIT) { return mentionCount(content) >= limit; }

function isCapsHeavy(content) {
  // ignore mentions, emoji and links so "<@123> LOL" or a URL does not count
  const s = String(content || '').replace(/<a?:\w+:\d+>|<[@#][!&]?\d+>|https?:\/\/\S+/g, '');
  const letters = s.match(/\p{L}/gu) || [];
  if (letters.length < CAPS_MIN_LETTERS) return false;
  const cased = letters.filter((c) => c.toLowerCase() !== c.toUpperCase());
  if (cased.length < CAPS_MIN_LETTERS) return false;
  const upper = cased.filter((c) => c === c.toUpperCase()).length;
  return upper / cased.length >= CAPS_RATIO;
}

// --- strike counter: in memory, per guild:user:trigger, bounded in both age and size ---

class StrikeCounter {
  constructor({ maxEntries = 20000, maxPerKey = 20, now = () => Date.now() } = {}) {
    this.map = new Map(); // key -> { ts: number[], windowMs }
    this.maxEntries = maxEntries;
    this.maxPerKey = maxPerKey;
    this.now = now;
  }

  // Record a strike and return how many fall inside the rolling window (this one included).
  hit(key, windowMs) {
    const now = this.now();
    const e = this.map.get(key);
    const ts = e ? e.ts.filter((t) => now - t < windowMs) : [];
    ts.push(now);
    if (ts.length > this.maxPerKey) ts.splice(0, ts.length - this.maxPerKey);
    this.map.delete(key); // re-insert so Map order stays least-recently-hit first
    this.map.set(key, { ts, windowMs });
    while (this.map.size > this.maxEntries) this.map.delete(this.map.keys().next().value);
    return ts.length;
  }

  reset(key) { this.map.delete(key); }

  // Drop every key whose newest strike has left its window.
  sweep() {
    const now = this.now();
    for (const [k, e] of this.map) if (now - e.ts[e.ts.length - 1] >= e.windowMs) this.map.delete(k);
  }

  get size() { return this.map.size; }
}

module.exports = {
  TRIGGERS, ACTIONS, LABELS, DEFAULT_TIMEOUT_MIN, DEFAULT_WINDOW_MIN, MAX_TIMEOUT_MIN, MAX_WINDOW_MIN, MENTION_LIMIT,
  CAPS_MIN_LETTERS, CAPS_RATIO, SPAM_THRESHOLD, SPAM_WINDOW_MS, SPAM_TIMEOUT_MS,
  normalizeRule, normalizeRules, ladderStep, describeRule, hasInvite, mentionCount, isMassMention, isCapsHeavy, StrikeCounter,
};
