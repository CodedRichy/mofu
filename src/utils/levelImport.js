// Parse an XP/level file the server owner exported from another bot, and plan the import.
// Pure functions only (no Discord, no database), so the command and the tests share them.
//
// Accepted input:
//   CSV (comma, semicolon or tab, detected like the warnings import) with a header line:
//     user_id,xp      total XP per member (preferred)
//     user_id,level   level per member; converted to the total XP Sonder needs for that level
//   JSON: an array of objects with the same keys, or an object holding such an array.
// Sonder never logs in to another bot or reads its website: the owner brings the file.
const { parseCsv } = require('./csvImport');

const MAX_ROWS = 20000;
const SNOWFLAKE = /^\d{15,21}$/;
const MAX_ERRORS = 10;

const ALIASES = {
  user: ['user_id', 'userid', 'user', 'member', 'member_id', 'id', 'discord_id', 'uid'],
  xp: ['xp', 'total_xp', 'totalxp', 'experience', 'exp', 'points'],
  level: ['level', 'lvl'],
};

function normalizeKey(k) {
  return String(k).trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function findColumn(names, key) {
  return names.findIndex((n) => ALIASES[key].includes(n));
}

// Non-negative whole number, or null. Accepts "1200", "1 200", "1_200"; rejects "12.5", "-3", "1e5".
function toCount(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  const v = String(value ?? '').trim().replace(/[ _]/g, '');
  if (!/^\d{1,15}$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

// Turn one record into { userId, xp, level } or an error string.
function readRecord(userRaw, xpRaw, levelRaw, mode) {
  const userId = String(userRaw ?? '').trim();
  if (!SNOWFLAKE.test(userId)) return { error: `"${userId.slice(0, 30)}" is not a user id.` };
  if (mode === 'xp') {
    const xp = toCount(xpRaw);
    if (xp === null) return { error: `XP "${String(xpRaw ?? '').slice(0, 20)}" is not a whole number.` };
    return { userId, xp, level: null };
  }
  const level = toCount(levelRaw);
  if (level === null) return { error: `level "${String(levelRaw ?? '').slice(0, 20)}" is not a whole number.` };
  return { userId, xp: null, level };
}

function parseCsvLevels(text) {
  const table = parseCsv(text);
  const errors = [];
  if (table.unterminatedFrom) errors.push(`line ${table.unterminatedFrom}: a quote was opened and never closed, so the rest of the file was skipped.`);
  if (!table.length) return { records: [], errors: errors.length ? errors : ['the file is empty.'], mode: null, truncated: false };

  const names = table[0].map(normalizeKey);
  const userCol = findColumn(names, 'user');
  const xpCol = findColumn(names, 'xp');
  const levelCol = findColumn(names, 'level');
  if (userCol < 0 || (xpCol < 0 && levelCol < 0)) {
    return { records: [], errors: ['the first line must be a header such as `user_id,xp` or `user_id,level`.'], mode: null, truncated: false };
  }
  const mode = xpCol >= 0 ? 'xp' : 'level';
  const records = [];
  let truncated = false;
  for (let i = 1; i < table.length; i++) {
    if (records.length >= MAX_ROWS) { truncated = true; break; }
    const c = table[i];
    const r = readRecord(c[userCol], c[xpCol], c[levelCol], mode);
    if (r.error) { if (errors.length < MAX_ERRORS) errors.push(`line ${i + 1}: ${r.error}`); continue; }
    records.push(r);
  }
  return { records, errors, mode, truncated };
}

function parseJsonLevels(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { records: [], errors: ['the file is not valid JSON.'], mode: null, truncated: false }; }
  let list = Array.isArray(data) ? data : null;
  if (!list && data && typeof data === 'object') {
    list = Object.values(data).find((v) => Array.isArray(v)) || null;
  }
  if (!list) return { records: [], errors: ['expected a JSON array of objects like {"user_id": "...", "xp": 1200}.'], mode: null, truncated: false };

  const objs = list.filter((o) => o && typeof o === 'object' && !Array.isArray(o));
  const keysOf = (o) => Object.keys(o).map((k) => [normalizeKey(k), k]);
  const sample = objs.length ? keysOf(objs[0]).map(([n]) => n) : [];
  const hasXp = sample.some((n) => ALIASES.xp.includes(n));
  const hasLevel = sample.some((n) => ALIASES.level.includes(n));
  if (!objs.length || !sample.some((n) => ALIASES.user.includes(n)) || (!hasXp && !hasLevel)) {
    return { records: [], errors: ['each entry needs a user id and either `xp` or `level`.'], mode: null, truncated: false };
  }
  const mode = hasXp ? 'xp' : 'level';
  const pick = (o, key) => {
    for (const [n, k] of keysOf(o)) if (ALIASES[key].includes(n)) return o[k];
    return undefined;
  };

  const records = [];
  const errors = [];
  let truncated = false;
  for (let i = 0; i < list.length; i++) {
    if (records.length >= MAX_ROWS) { truncated = true; break; }
    const o = list[i];
    if (!o || typeof o !== 'object' || Array.isArray(o)) { if (errors.length < MAX_ERRORS) errors.push(`entry ${i + 1}: not an object.`); continue; }
    const r = readRecord(pick(o, 'user'), pick(o, 'xp'), pick(o, 'level'), mode);
    if (r.error) { if (errors.length < MAX_ERRORS) errors.push(`entry ${i + 1}: ${r.error}`); continue; }
    records.push(r);
  }
  return { records, errors, mode, truncated };
}

/**
 * @returns {{ records: {userId, xp, level}[], errors: string[], mode: 'xp'|'level'|null, truncated: boolean }}
 */
function parseLevelsFile(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const first = src.trimStart()[0];
  return first === '[' || first === '{' ? parseJsonLevels(src) : parseCsvLevels(src);
}

/**
 * Work out what an import would do. Read-only.
 * @param records   from parseLevelsFile
 * @param opts.isMember(id) -> boolean    member is in the server
 * @param opts.isBot(id) -> boolean
 * @param opts.currentTotal(id) -> number current Sonder total XP
 * @param opts.totalXpForLevel(level) -> number
 * @param opts.maxXp  clamp for imported totals
 * @param opts.overwrite  replace instead of keeping the higher value
 */
function planImport(records, { isMember, isBot, currentTotal, totalXpForLevel, maxXp = 2 ** 31, overwrite = false }) {
  // Duplicate ids in one file: keep the highest value.
  const best = new Map();
  let duplicates = 0;
  for (const r of records) {
    const total = Math.min(r.xp !== null ? r.xp : totalXpForLevel(r.level), maxXp);
    if (best.has(r.userId)) { duplicates++; if (total <= best.get(r.userId)) continue; }
    best.set(r.userId, total);
  }

  const plan = { rows: records.length, duplicates, bots: 0, notInServer: 0, unchanged: 0, raise: 0, lower: 0, totalXp: 0, changes: [] };
  for (const [userId, total] of best) {
    if (isBot(userId)) { plan.bots++; continue; }
    if (!isMember(userId)) { plan.notInServer++; continue; }
    const cur = currentTotal(userId) || 0;
    const target = overwrite ? total : Math.max(cur, total);
    if (target === cur) { plan.unchanged++; continue; }
    if (target > cur) plan.raise++; else plan.lower++;
    plan.totalXp += total;
    plan.changes.push({ userId, from: cur, to: target, incoming: total });
  }
  plan.changes.sort((a, b) => b.to - a.to);
  return plan;
}

module.exports = { parseLevelsFile, planImport, toCount, MAX_ROWS };
