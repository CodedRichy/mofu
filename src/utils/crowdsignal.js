// Crowd signal: "the chat just reacted to an image like something was wrong". Pure logic, no Discord objects,
// no network, no database. It decides WHEN a vision check is worth running; it never looks at the image.
//
// How it works
//  - Every message after the first few minutes updates a per-channel baseline (messages per minute, share of
//    capital letters). Nothing but those two numbers is kept, never message text.
//  - A message that carries an image (attachment, image embed, sticker, GIF link) opens a WINDOW_MS window.
//  - Inside the window we count distinct people who: write shock phrases, call for mods, reply to the image,
//    plus a jump in caps and in message rate versus the baseline. Reactions with alarm emoji are scored
//    separately (they arrive without the Message Content intent), so the feature still works, more weakly,
//    when text is not visible.
//  - A window fires once, when its score passes the channel threshold. The threshold starts at a constant and
//    is nudged by moderator feedback counters (Delete = confirmed, Dismiss = false alarm). Counters only.
//
// Phrase lists are English, Hinglish and Spanish, written without accents (input is folded the same way).

const WINDOW_MS = 30 * 1000;

// Score weights and thresholds. Everything tunable lives here.
const WEIGHTS = Object.freeze({
  shockPerAuthor: 1, shockMax: 6,
  modCallPerAuthor: 1.5, modCallMax: 6,
  replyPerAuthor: 0.5, replyMax: 3,
  capsJump: 1,
  rateJump: 1.5,
  reactionMax: 6,
});
const FIRE_THRESHOLD = 5;       // text + reply + rate + reaction total needed to fire
const REACTION_FIRE = 4;        // reaction score alone needed to fire (works without message text)
const MIN_PEOPLE = 2;           // distinct people behind a combined fire (one loud person is not a crowd)
const MIN_THRESHOLD = 3.5;
const MAX_THRESHOLD = 9;
const NUDGE_PER_VOTE = 0.25;    // each net false alarm raises the bar, each net confirmation lowers it
const MAX_NUDGE = 2;
const COUNTER_CAP = 50;         // counters are halved when one reaches this, so old feedback fades
const CAPS_JUMP_DELTA = 0.3;    // window caps share minus baseline caps share
const CAPS_MIN_MESSAGES = 3;
const RATE_JUMP_FACTOR = 3;     // window rate versus baseline rate
const RATE_MIN_AUTHORS = 3;
const BASELINE_MIN_MINUTES = 3; // minutes of history before caps and rate comparisons count
const BASELINE_FLOOR_RATE = 1;  // baseline messages per minute is never below this (quiet channels)
const MAX_CHANNELS = 1000;
const MAX_WINDOWS_PER_CHANNEL = 6;
const MAX_PEOPLE_PER_WINDOW = 60;

// ---------- text ----------

function fold(text) {
  return String(text || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // accents off: "qué" -> "que"
    .toLowerCase()
    .replace(/(.)\1{2,}/g, '$1') // "wtfffff" -> "wtf", "modsss" -> "mods"
    .replace(/\s+/g, ' ')
    .trim();
}

const SHOCK = [
  // English
  /\bwtf\b/, /\bwth\b/, /\bwhat the (?:f+|fuck|hell|heck|actual)\b/, /\bbro what\b/, /\bbruh what\b/, /\bdude what\b/,
  /\bwhat is (?:that|this)\b/, /\bwhat was that\b/, /\bmy eyes\b/, /\bi'?m blind\b/, /\boh my god\b/, /\bjesus christ\b/,
  /\bdisgusting\b/, /\bgross\b/, /\bwhy would you (?:post|send)\b/, /\bwhat the\b/, /\bnot cool\b/, /^yo+\?+!*$/, /\byo\?+!+/,
  // Hinglish
  /\bye kya hai\b/, /\byeh kya hai\b/, /\bkya hai ye\b/, /\bkya bakwas\b/, /\bbhai kya\b/, /\bbhai ye kya\b/, /\bsharam\b/,
  /\bgandi\b/, /\bchee\b/, /\bkya kar rahe\b/, /\bye sab kya\b/,
  // Spanish
  /\bque carajo\b/, /\bque mierda\b/, /\bque asco\b/, /\bpor dios\b/, /\bque es eso\b/, /\bno manches\b/, /\bque verga\b/,
  /\bque demonios\b/, /\bque porqueria\b/, /\bno mames\b/,
];

const MOD_CALL = [
  // English
  /\bmods?\b/, /\bmoderators?\b/, /\bwhere are the mods\b/, /\breport(?:ed|ing)?\b/, /\bban (?:him|her|them|this|that|dude|guy|u)\b/,
  /\bdelete (?:that|this|it)\b/, /\bsomeone delete\b/, /\bremove (?:that|this|it)\b/, /\bstaff\b/, /\badmins?\b/,
  // Hinglish
  /\bmods? kaha\b/, /\bmods? kidhar\b/, /\bkaha hain mods?\b/, /\bkahan hain mods?\b/, /\bmods? kahan\b/, /\bhata do\b/,
  /\bhatao\b/, /\bdelete karo\b/, /\bban karo\b/, /\bban kar do\b/, /\bmods? ko bulao\b/,
  // Spanish
  /\bmoderadores?\b/, /\bmods? donde\b/, /\bdonde estan los mods\b/, /\bborren eso\b/, /\bborra eso\b/, /\bbaneen\b/,
  /\bbanealo\b/, /\bdenuncien\b/, /\breporten\b/, /\bban(?:ea|eenlo)\b/,
];

function matchesAny(list, text) {
  for (const re of list) if (re.test(text)) return true;
  return false;
}

// { shock, modCall } for one message. Empty text (no Message Content intent) matches nothing.
function classifyText(text) {
  const t = fold(text);
  if (!t) return { shock: false, modCall: false };
  return { shock: matchesAny(SHOCK, t), modCall: matchesAny(MOD_CALL, t) };
}

// Share of capital letters among letters, or null for messages too short to say anything.
function capsRatio(text) {
  const s = String(text || '');
  let upper = 0;
  let letters = 0;
  for (const ch of s) {
    const lo = ch.toLowerCase();
    const up = ch.toUpperCase();
    if (lo === up) continue; // not a cased letter
    letters++;
    if (ch === up) upper++;
  }
  return letters >= 6 ? upper / letters : null;
}

// ---------- images ----------

const GIF_LINK = /https?:\/\/(?:[\w-]+\.)?(?:tenor\.com|giphy\.com)\/\S+|https?:\/\/\S+\.gif(?:\?\S*)?(?:\s|$)/i;

// Plain data in, boolean out: does this message carry something visual?
function hasImagePost({ attachments = [], embeds = [], stickerCount = 0, content = '' } = {}) {
  if (stickerCount > 0) return true;
  for (const a of attachments) {
    const ct = String(a?.contentType || '');
    if (/^image\//i.test(ct) || /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(String(a?.name || a?.url || ''))) return true;
  }
  for (const e of embeds) {
    if (e?.image || e?.thumbnail || e?.type === 'image' || e?.type === 'gifv' || e?.video) return true;
  }
  return GIF_LINK.test(String(content || ''));
}

// ---------- emoji ----------

// Weight per alarm emoji. Skull is common as a joke reaction, so it counts for less; eyes barely counts.
const ALARM_EMOJI = Object.freeze({
  '🚩': 1, '🚨': 1, '🤢': 1, '🤮': 1, '⚠': 1, '🔞': 1, '😨': 0.7, '😱': 0.7, '💀': 0.5, '👀': 0.3,
});

function emojiWeight(name) {
  const key = String(name || '').replace(/️/g, '');
  return ALARM_EMOJI[key] || 0;
}

// ---------- baseline ----------

class Baseline {
  constructor() {
    this.bucketStart = 0;
    this.bucketCount = 0;
    this.minutes = 0;     // closed minutes seen
    this.rate = 0;        // smoothed messages per minute
    this.caps = 0;        // smoothed caps share
    this.capsSamples = 0;
  }

  _roll(now) {
    const start = Math.floor(now / 60000) * 60000;
    if (!this.bucketStart) { this.bucketStart = start; return; }
    if (start <= this.bucketStart) return;
    const gap = Math.min(10, Math.floor((start - this.bucketStart) / 60000)); // idle minutes count as zeros
    for (let i = 0; i < gap; i++) {
      const n = i === 0 ? this.bucketCount : 0;
      this.rate = this.minutes === 0 ? n : this.rate * 0.8 + n * 0.2;
      this.minutes++;
    }
    this.bucketStart = start;
    this.bucketCount = 0;
  }

  record(now, text) {
    this._roll(now);
    this.bucketCount++;
    const c = capsRatio(text);
    if (c !== null) {
      this.capsSamples++;
      this.caps = this.capsSamples === 1 ? c : this.caps * 0.95 + c * 0.05;
    }
  }

  ready() { return this.minutes >= BASELINE_MIN_MINUTES; }
  perMinute() { return Math.max(BASELINE_FLOOR_RATE, this.rate); }
}

// ---------- scoring ----------

function newWindow({ messageId, authorId, now }) {
  return {
    messageId, authorId, openedAt: now, fired: false,
    shock: new Set(), modCall: new Set(), repliers: new Set(), reactors: new Map(), // userId -> weight
    authors: new Set(), messages: 0, capsSum: 0, capsN: 0,
  };
}

const capSet = (set, id) => { if (set.size < MAX_PEOPLE_PER_WINDOW) set.add(id); };

// Score one window against a baseline. Returns the parts so callers (and tests) can see why.
function scoreWindow(win, baseline, now = Date.now()) {
  const reasons = [];
  let text = 0;

  const shock = Math.min(win.shock.size * WEIGHTS.shockPerAuthor, WEIGHTS.shockMax);
  if (shock) { text += shock; reasons.push(`${win.shock.size} people wrote shock phrases`); }
  const call = Math.min(win.modCall.size * WEIGHTS.modCallPerAuthor, WEIGHTS.modCallMax);
  if (call) { text += call; reasons.push(`${win.modCall.size} people called for mods`); }
  const reply = Math.min(win.repliers.size * WEIGHTS.replyPerAuthor, WEIGHTS.replyMax);
  if (reply) { text += reply; reasons.push(`${win.repliers.size} people replied to the image`); }

  if (baseline && baseline.ready()) {
    if (win.capsN >= CAPS_MIN_MESSAGES) {
      const winCaps = win.capsSum / win.capsN;
      if (winCaps - baseline.caps >= CAPS_JUMP_DELTA) { text += WEIGHTS.capsJump; reasons.push('capital letters jumped versus this channel\'s normal'); }
    }
    const elapsed = Math.max(5000, Math.min(WINDOW_MS, now - win.openedAt));
    const winRate = (win.messages * 60000) / elapsed;
    if (win.authors.size >= RATE_MIN_AUTHORS && winRate >= baseline.perMinute() * RATE_JUMP_FACTOR) {
      text += WEIGHTS.rateJump; reasons.push('message rate jumped versus this channel\'s normal');
    }
  }

  let reactionTotal = 0;
  for (const w of win.reactors.values()) reactionTotal += w;
  const reaction = Math.min(reactionTotal, WEIGHTS.reactionMax);
  if (reaction) reasons.push(`${win.reactors.size} people reacted with alarm emoji`);

  const people = new Set([...win.shock, ...win.modCall, ...win.repliers, ...win.reactors.keys()]).size;
  return { score: round(text + reaction), textScore: round(text), reactionScore: round(reaction), people, reasons };
}

const round = (n) => Math.round(n * 100) / 100;

// ---------- adaptive threshold ----------

function normalizeCounters(c) {
  const r = c && typeof c === 'object' ? c : {};
  const n = (v) => (Number.isFinite(v) && v > 0 ? Math.min(COUNTER_CAP, Math.floor(v)) : 0);
  return { confirmed: n(r.confirmed), falseAlarm: n(r.falseAlarm) };
}

function nudgeFor(counters) {
  const c = normalizeCounters(counters);
  const raw = (c.falseAlarm - c.confirmed) * NUDGE_PER_VOTE;
  return Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, raw));
}

const clampThreshold = (v) => Math.max(MIN_THRESHOLD, Math.min(MAX_THRESHOLD, v));
const thresholdFor = (counters) => clampThreshold(FIRE_THRESHOLD + nudgeFor(counters));
const reactionThresholdFor = (counters) => clampThreshold(REACTION_FIRE + nudgeFor(counters));

// kind: 'confirmed' | 'falseAlarm'. Returns new counters (halves both at the cap so old feedback fades).
function bumpCounters(counters, kind) {
  const c = normalizeCounters(counters);
  if (kind !== 'confirmed' && kind !== 'falseAlarm') return c;
  c[kind] += 1;
  if (c[kind] >= COUNTER_CAP) { c.confirmed = Math.floor(c.confirmed / 2); c.falseAlarm = Math.floor(c.falseAlarm / 2); }
  return c;
}

// ---------- tracker ----------

class CrowdTracker {
  constructor({ windowMs = WINDOW_MS, maxChannels = MAX_CHANNELS } = {}) {
    this.windowMs = windowMs;
    this.maxChannels = maxChannels;
    this.channels = new Map(); // channelId -> { baseline, windows: Map(messageId -> window), counters }
  }

  _channel(channelId) {
    let ch = this.channels.get(channelId);
    if (ch) { this.channels.delete(channelId); } else { ch = { baseline: new Baseline(), windows: new Map(), counters: normalizeCounters(null) }; }
    this.channels.set(channelId, ch); // recency order for eviction
    while (this.channels.size > this.maxChannels) this.channels.delete(this.channels.keys().next().value);
    return ch;
  }

  _prune(ch, now) {
    for (const [id, w] of ch.windows) if (now - w.openedAt > this.windowMs) ch.windows.delete(id);
    while (ch.windows.size > MAX_WINDOWS_PER_CHANNEL) ch.windows.delete(ch.windows.keys().next().value);
  }

  setCounters(channelId, counters) { this._channel(channelId).counters = normalizeCounters(counters); }
  getCounters(channelId) { return { ...this._channel(channelId).counters }; }
  threshold(channelId) { return thresholdFor(this._channel(channelId).counters); }

  // Apply moderator feedback and return the new counters for the caller to persist.
  feedback(channelId, kind) {
    const ch = this._channel(channelId);
    ch.counters = bumpCounters(ch.counters, kind);
    return { ...ch.counters };
  }

  // Open a window for an image message the tracker has not seen (for example found through a reaction).
  openWindow({ channelId, messageId, authorId, now = Date.now() }) {
    const ch = this._channel(channelId);
    this._prune(ch, now);
    if (!ch.windows.has(messageId)) ch.windows.set(messageId, newWindow({ messageId, authorId, now }));
    return ch.windows.get(messageId);
  }

  hasWindow(channelId, messageId) { return Boolean(this.channels.get(channelId)?.windows.has(messageId)); }

  _evaluate(channelId, ch, now) {
    const events = [];
    for (const w of ch.windows.values()) {
      if (w.fired) continue;
      const s = scoreWindow(w, ch.baseline, now);
      const threshold = thresholdFor(ch.counters);
      const rThreshold = reactionThresholdFor(ch.counters);
      let via = null;
      if (s.reactionScore >= rThreshold) via = 'reactions';
      else if (s.score >= threshold && s.people >= MIN_PEOPLE) via = 'crowd';
      if (!via) continue;
      w.fired = true;
      events.push({ channelId, messageId: w.messageId, authorId: w.authorId, via, threshold: via === 'reactions' ? rThreshold : threshold, ...s });
    }
    return events;
  }

  // One message. Returns the windows that fired because of it. m: { channelId, messageId, authorId, content,
  // isImage, replyToId, now }.
  observeMessage(m) {
    const now = m.now ?? Date.now();
    const ch = this._channel(m.channelId);
    this._prune(ch, now);
    const content = String(m.content || '');

    // Evaluate against the baseline as it was before this message, then fold the message in.
    const caps = capsRatio(content);
    const cls = classifyText(content);
    for (const w of ch.windows.values()) {
      if (w.fired || w.authorId === m.authorId || m.messageId === w.messageId) continue;
      w.messages++;
      capSet(w.authors, m.authorId);
      if (caps !== null) { w.capsSum += caps; w.capsN++; }
      if (cls.shock) capSet(w.shock, m.authorId);
      if (cls.modCall) capSet(w.modCall, m.authorId);
      if (m.replyToId && m.replyToId === w.messageId) capSet(w.repliers, m.authorId);
    }
    ch.baseline.record(now, content);

    if (m.isImage && !ch.windows.has(m.messageId)) {
      ch.windows.set(m.messageId, newWindow({ messageId: m.messageId, authorId: m.authorId, now }));
    }
    return this._evaluate(m.channelId, ch, now);
  }

  // One reaction add. Only alarm emoji count, only on a tracked window, never from the image author.
  observeReaction({ channelId, messageId, userId, emoji, now = Date.now() }) {
    const ch = this.channels.get(channelId);
    if (!ch) return [];
    this._prune(ch, now);
    const w = ch.windows.get(messageId);
    if (!w || w.fired || w.authorId === userId) return [];
    const weight = emojiWeight(emoji);
    if (!weight) return [];
    if (w.reactors.size < MAX_PEOPLE_PER_WINDOW || w.reactors.has(userId)) w.reactors.set(userId, Math.max(weight, w.reactors.get(userId) || 0));
    return this._evaluate(channelId, ch, now);
  }

  // Test and status helper.
  peek(channelId, messageId, now = Date.now()) {
    const ch = this.channels.get(channelId);
    const w = ch?.windows.get(messageId);
    return w ? scoreWindow(w, ch.baseline, now) : null;
  }
}

module.exports = {
  WINDOW_MS, WEIGHTS, FIRE_THRESHOLD, REACTION_FIRE, MIN_PEOPLE, MIN_THRESHOLD, MAX_THRESHOLD, COUNTER_CAP,
  fold, classifyText, capsRatio, hasImagePost, emojiWeight, ALARM_EMOJI,
  Baseline, scoreWindow, newWindow,
  normalizeCounters, nudgeFor, thresholdFor, reactionThresholdFor, bumpCounters,
  CrowdTracker,
};
