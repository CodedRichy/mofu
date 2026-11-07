// Pure input validators for the dashboard API. No I/O, no store access: safe to unit test.

const SNOWFLAKE_RE = /^\d{17,20}$/;
const isSnowflake = (v) => typeof v === 'string' && SNOWFLAKE_RE.test(v);

const MAX_HISTORY_ITEMS = 10;
const MAX_HISTORY_CONTENT = 1000;
const MAX_MESSAGE = 2000;

const ECON_MAX = 1e12;
const XP_MAX = 2147483647;
const LEVEL_MAX = 1000;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = (error) => ({ ok: false, error });
const good = (value) => ({ ok: true, value });

// ---- per-key validators: (value) => {ok, value} | {ok:false, error} ----
const snowflakeOrNull = (v) => (v === null || isSnowflake(v) ? good(v) : fail('must be a channel/role id (snowflake) or null'));
const bool = (v) => (typeof v === 'boolean' ? good(v) : fail('must be true or false'));

function str({ min = 0, max = 2000, nullable = true, trim = false } = {}) {
  return (v) => {
    if (v === null) return nullable ? good(null) : fail('must be a string');
    if (typeof v !== 'string') return fail('must be a string');
    const s = trim ? v.trim() : v;
    if (s.length < min) return fail(`must be at least ${min} characters`);
    if (s.length > max) return fail(`must be at most ${max} characters`);
    return good(s);
  };
}

function strArray({ maxItems = 100, maxLen = 100, lower = false } = {}) {
  return (v) => {
    if (!Array.isArray(v)) return fail('must be an array of strings');
    if (v.length > maxItems) return fail(`must have at most ${maxItems} items`);
    const out = [];
    for (const item of v) {
      if (typeof item !== 'string') return fail('items must be strings');
      let s = item.trim();
      if (lower) s = s.toLowerCase();
      if (!s.length) return fail('items must not be empty');
      if (s.length > maxLen) return fail(`items must be at most ${maxLen} characters`);
      out.push(s);
    }
    return good([...new Set(out)]);
  };
}

function snowflakeArray(maxItems = 100) {
  return (v) => {
    if (!Array.isArray(v)) return fail('must be an array of ids');
    if (v.length > maxItems) return fail(`must have at most ${maxItems} items`);
    if (!v.every(isSnowflake)) return fail('items must be ids (snowflakes)');
    return good([...new Set(v)]);
  };
}

function intRange(min, max) {
  return (v) => (Number.isSafeInteger(v) && v >= min && v <= max ? good(v) : fail(`must be an integer from ${min} to ${max}`));
}

function numRange(min, max) {
  return (v) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? good(v) : fail(`must be a number from ${min} to ${max}`));
}

function levelRoles(v) {
  if (!Array.isArray(v)) return fail('must be an array');
  if (v.length > 50) return fail('must have at most 50 items');
  const out = [];
  for (const e of v) {
    if (!isPlainObject(e)) return fail('items must be objects');
    const level = e.level;
    const role = e.role ?? e.roleId;
    if (!Number.isSafeInteger(level) || level < 0 || level > LEVEL_MAX) return fail(`item level must be an integer from 0 to ${LEVEL_MAX}`);
    if (!isSnowflake(role)) return fail('item role must be a role id');
    out.push({ level, role });
  }
  return good(out);
}

const enumOf = (...opts) => (v) => (opts.includes(v) ? good(v) : fail(`must be one of: ${opts.join(', ')}`));

// Explicit allowlist: every config key the dashboard may write, with its schema.
const CONFIG_SCHEMA = {
  prefix: str({ min: 1, max: 5, trim: true }),
  welcome_channel: snowflakeOrNull,
  welcome_message: str({ max: 2000 }),
  welcome_card: bool,
  goodbye_channel: snowflakeOrNull,
  goodbye_message: str({ max: 2000 }),
  goodbye_card: bool,
  modlog_channel: snowflakeOrNull,
  log_channel: snowflakeOrNull,
  logging_channel: snowflakeOrNull,
  audit_log_channel: snowflakeOrNull,
  levelup_channel: snowflakeOrNull,
  leveling: bool,
  antispam: bool,
  antilink: bool,
  ai_automod: bool,
  word_filter: strArray({ maxItems: 200, maxLen: 100 }),
  word_filter_list: strArray({ maxItems: 200, maxLen: 100 }),
  antilink_whitelist: strArray({ maxItems: 100, maxLen: 100, lower: true }),
  antispam_threshold: intRange(2, 50),
  antispam_action: enumOf('timeout', 'delete', 'warn', 'kick', 'mute'),
  antispam_duration: intRange(0, 2419200),
  xp_multiplier: numRange(0, 10),
  level_roles: levelRoles,
  no_xp_channels: snowflakeArray(100),
  no_xp_roles: snowflakeArray(100),
};

// Which keys each write route may touch.
const ROUTE_KEYS = {
  config: [
    'prefix', 'welcome_channel', 'welcome_message', 'welcome_card',
    'goodbye_channel', 'goodbye_message', 'goodbye_card',
    'modlog_channel', 'log_channel', 'logging_channel', 'audit_log_channel', 'levelup_channel',
    'leveling', 'antispam', 'antilink', 'ai_automod', 'word_filter',
  ],
  automod: [
    'antispam', 'antispam_threshold', 'antispam_action', 'antispam_duration',
    'antilink', 'antilink_whitelist', 'word_filter', 'word_filter_list',
  ],
  leveling: ['enabled', 'levelup_channel', 'xp_multiplier', 'level_roles', 'no_xp_channels', 'no_xp_roles'],
};

// Validate a PATCH body against a route's allowed keys. Unknown keys reject the whole request (400),
// so a client never gets a partial write. Returns { ok, values } (values keyed by the stored config key).
function validateConfigPatch(body, route) {
  const allowed = ROUTE_KEYS[route];
  if (!allowed) throw new Error(`unknown route set: ${route}`);
  if (!isPlainObject(body)) return fail('Body must be a JSON object');
  const entries = Object.entries(body);
  if (!entries.length) return fail('No settings provided');
  const values = {};
  for (const [key, raw] of entries) {
    if (!allowed.includes(key)) return fail(`Unknown setting: ${key.slice(0, 40)}`);
    const storeKey = key === 'enabled' ? 'leveling' : key;
    const r = CONFIG_SCHEMA[storeKey](raw);
    if (!r.ok) return fail(`${key.slice(0, 40)} ${r.error}`);
    values[storeKey] = r.value;
  }
  return { ok: true, values };
}

function validateEconomyPatch(body) {
  if (!isPlainObject(body)) return fail('Body must be a JSON object');
  const out = {};
  for (const k of ['wallet', 'bank']) {
    if (body[k] === undefined) continue;
    const v = body[k];
    if (!Number.isSafeInteger(v) || v < 0 || v > ECON_MAX) return fail(`${k} must be an integer from 0 to ${ECON_MAX}`);
    out[k] = v;
  }
  if (!Object.keys(out).length) return fail('Provide wallet or bank');
  return { ok: true, values: out };
}

function validateXpPatch(body) {
  if (!isPlainObject(body)) return fail('Body must be a JSON object');
  if (body.level !== undefined) {
    if (!Number.isSafeInteger(body.level) || body.level < 0 || body.level > LEVEL_MAX) return fail(`level must be an integer from 0 to ${LEVEL_MAX}`);
    return { ok: true, values: { level: body.level } };
  }
  if (body.xp !== undefined) {
    if (!Number.isSafeInteger(body.xp) || body.xp < 0 || body.xp > XP_MAX) return fail(`xp must be an integer from 0 to ${XP_MAX}`);
    return { ok: true, values: { xp: body.xp } };
  }
  return fail('Provide xp or level');
}

function validateCustomCommand(body) {
  if (!isPlainObject(body)) return fail('Body must be a JSON object');
  const { name, response } = body;
  if (typeof name !== 'string' || typeof response !== 'string' || !name || !response.trim()) return fail('Name and response are required');
  if (!/^[a-z0-9_-]{1,32}$/i.test(name)) return fail('Name must be 1-32 characters: letters, numbers, - or _');
  if (response.length > 2000) return fail('Response must be 2000 characters or less');
  return { ok: true, values: { name: name.toLowerCase(), response } };
}

// Client history is untrusted: never let it carry a system/developer/tool role.
function sanitizeHistory(history) {
  if (history === undefined || history === null) return { ok: true, value: [] };
  if (!Array.isArray(history)) return fail('history must be an array');
  const out = [];
  for (const m of history.slice(-MAX_HISTORY_ITEMS)) {
    if (!isPlainObject(m) || typeof m.content !== 'string') continue;
    const content = m.content.trim().slice(0, MAX_HISTORY_CONTENT);
    if (!content) continue;
    out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content });
  }
  return { ok: true, value: out };
}

function validateAiChat(body) {
  if (!isPlainObject(body)) return fail('Body must be a JSON object');
  if (typeof body.message !== 'string' || !body.message.trim()) return fail('No message');
  if (body.message.length > MAX_MESSAGE) return fail(`Message must be ${MAX_MESSAGE} characters or less`);
  const h = sanitizeHistory(body.history);
  if (!h.ok) return h;
  return { ok: true, values: { message: body.message, history: h.value } };
}

// Discord permission bits (string or number) -> can this user manage the server?
function canManageGuild(g) {
  if (!g) return false;
  if (g.owner === true) return true;
  try {
    const p = BigInt(g.permissions);
    return (p & 0x20n) !== 0n || (p & 0x8n) !== 0n;
  } catch { return false; }
}

// TRUST_PROXY env -> express 'trust proxy' value. Default 1 hop.
function parseTrustProxy(raw) {
  if (raw === undefined || raw === null || raw === '') return 1;
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s === 'true') return true;
  if (s === 'false') return false;
  return s; // e.g. 'loopback' or a CIDR list
}

module.exports = {
  isSnowflake, CONFIG_SCHEMA, ROUTE_KEYS,
  validateConfigPatch, validateEconomyPatch, validateXpPatch, validateCustomCommand,
  sanitizeHistory, validateAiChat, canManageGuild, parseTrustProxy,
  LIMITS: { ECON_MAX, XP_MAX, LEVEL_MAX, MAX_HISTORY_ITEMS, MAX_HISTORY_CONTENT, MAX_MESSAGE },
};
