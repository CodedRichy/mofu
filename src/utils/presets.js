// Punishment presets: a server-defined table "rule name -> action + duration + default reason", e.g. spam -> mute 1h.
// Stored as one config value (key PRESET_KEY) through the store. Pure helpers take the table as a plain object so
// they can be tested without a database; getPreset/listPresets/savePresets read and write the store lazily.

const { parse, format } = require('./duration');

const PRESET_KEY = 'punishment_presets';
const MAX_PRESETS = 25;
const NAME_RE = /^[a-z0-9_-]{1,24}$/;
const ACTIONS = Object.freeze(['warn', 'mute', 'kick', 'tempban', 'ban']);
const NEEDS_DURATION = new Set(['mute', 'tempban']);
const LIMITS = { mute: 28 * 86400000, tempban: 365 * 86400000 }; // Discord timeout cap / tempban cap
const MIN_MS = 60000;
const REASON_MAX = 512;

const normName = (n) => String(n ?? '').trim().toLowerCase();

// Validate and normalize user input. Returns { preset } or { error }.
function buildPreset({ action, duration, reason }) {
  const a = normName(action);
  if (!ACTIONS.includes(a)) return { error: `Action must be one of: ${ACTIONS.join(', ')}.` };
  const d = String(duration ?? '').trim().toLowerCase();
  const none = d === '' || d === 'none' || d === '-' || d === '0';
  let ms = null;
  if (NEEDS_DURATION.has(a)) {
    if (none) return { error: `A ${a} preset needs a duration, e.g. 1h or 7d.` };
    ms = parse(d);
    if (!ms) return { error: 'Invalid duration. Use something like 30m, 12h, 7d, 2w.' };
    if (ms < MIN_MS) return { error: 'Duration must be at least 1 minute.' };
    if (ms > LIMITS[a]) return { error: `A ${a} can last at most ${format(LIMITS[a])}.` };
  } else if (!none) {
    return { error: `A ${a} preset has no duration. Use none for the duration.` };
  }
  const r = reason === null || reason === undefined ? '' : String(reason).trim();
  if (r.length > REASON_MAX) return { error: `Reason is too long (max ${REASON_MAX} characters).` };
  return { preset: { action: a, durationMs: ms, reason: r || null } };
}

// table: { name: { action, durationMs, reason } }. Defensive: config values can be hand-edited or old.
function cleanTable(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    const name = normName(k);
    if (!NAME_RE.test(name) || !v || typeof v !== 'object') continue;
    const action = normName(v.action);
    if (!ACTIONS.includes(action)) continue;
    const ms = Number(v.durationMs);
    if (NEEDS_DURATION.has(action) ? !(ms >= MIN_MS && ms <= LIMITS[action]) : v.durationMs) continue;
    const reason = typeof v.reason === 'string' && v.reason.trim() ? v.reason.trim().slice(0, REASON_MAX) : null;
    out[name] = { action, durationMs: NEEDS_DURATION.has(action) ? ms : null, reason };
    if (Object.keys(out).length >= MAX_PRESETS) break;
  }
  return out;
}

function addToTable(table, name, input) {
  const n = normName(name);
  if (!NAME_RE.test(n)) return { error: 'Preset names are 1-24 characters: letters, numbers, - and _.' };
  const built = buildPreset(input);
  if (built.error) return built;
  const next = { ...cleanTable(table) };
  if (!(n in next) && Object.keys(next).length >= MAX_PRESETS) return { error: `A server can have at most ${MAX_PRESETS} presets.` };
  next[n] = built.preset;
  return { table: next, name: n, preset: built.preset, replaced: n in cleanTable(table) };
}

function removeFromTable(table, name) {
  const n = normName(name);
  const next = { ...cleanTable(table) };
  if (!(n in next)) return { error: `No preset named \`${n || '?'}\`.` };
  delete next[n];
  return { table: next, name: n };
}

function describePreset(name, p) {
  const dur = p.durationMs ? ` ${format(p.durationMs)}` : '';
  return `\`${name}\`: ${p.action}${dur}${p.reason ? ` - ${p.reason}` : ''}`;
}

// Does the punishment a moderator chose match the preset? choice: { action, durationMs }.
// Returns { consistent, differences: [text] }. A preset without a duration ignores the chosen duration.
function checkConsistency(preset, choice) {
  if (!preset) return { consistent: true, differences: [] };
  const diffs = [];
  const action = normName(choice?.action);
  if (action !== preset.action) diffs.push(`preset says ${preset.action}, you chose ${action || 'nothing'}`);
  else if (preset.durationMs && Number(choice?.durationMs) !== preset.durationMs) {
    const got = choice?.durationMs ? format(choice.durationMs) : 'no duration';
    diffs.push(`preset says ${preset.action} for ${format(preset.durationMs)}, you chose ${got}`);
  }
  return { consistent: diffs.length === 0, differences: diffs };
}

// deps (for tests): { store }
function listPresets(guildId, deps = {}) {
  const store = deps.store || require('../database/store');
  return cleanTable(store.getConfig(guildId, PRESET_KEY));
}

function getPreset(guildId, name, deps = {}) {
  return listPresets(guildId, deps)[normName(name)] || null;
}

function savePresets(guildId, table, deps = {}) {
  const store = deps.store || require('../database/store');
  const clean = cleanTable(table);
  store.setConfig(guildId, PRESET_KEY, Object.keys(clean).length ? clean : null);
  return clean;
}

module.exports = {
  PRESET_KEY, MAX_PRESETS, ACTIONS, NAME_RE,
  buildPreset, cleanTable, addToTable, removeFromTable, describePreset, checkConsistency,
  listPresets, getPreset, savePresets,
};
