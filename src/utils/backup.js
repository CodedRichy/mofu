// Daily SQLite snapshot: data/backups/sonder-YYYYMMDD-HHMM.db (UTC), newest KEEP kept.
// Uses better-sqlite3's online backup API (consistent with WAL, does not block writers for long).
// Started once from the ready event; does nothing under the test runner or with BACKUPS=0.
const fs = require('fs');
const path = require('path');
const log = require('./logger');

const KEEP = 7;
const DAY_MS = 86400000;
const CHECK_MS = 60 * 60 * 1000; // wake hourly, back up when the newest file is a day old
const NAME_RE = /^sonder-(\d{8})-(\d{4})\.db$/;
const DEFAULT_DIR = path.join(__dirname, '..', '..', 'data', 'backups');

// Guild config export (the /backup command). Version 2 adds panels, tags and the newer feature settings.
// Version 1 files still import. No message text, tokens or secrets: only config values, tag/panel definitions.
const EXPORT_VERSION = 2;
const CONFIG_KEYS = [
  'prefix', 'welcome_channel', 'welcome_message', 'welcome_card',
  'goodbye_channel', 'goodbye_message', 'goodbye_card',
  'log_channel', 'modlog_channel', 'audit_log_channel',
  'log_message_delete', 'log_message_edit', 'log_member_join',
  'log_member_leave', 'log_role_change', 'log_voice', 'log_nickname',
  'antispam', 'antilink', 'antilink_whitelist', 'antiraid',
  'antiraid_threshold', 'antiraid_action', 'antiraid_account_age',
  'antinuke', 'antinuke_whitelist', 'antinuke_thresholds',
  'ai_automod', 'word_filter',
  'autoroles', 'ticket_enabled', 'ticket_support_role',
  'ticket_category', 'ticket_logs',
  'starboard_channel', 'starboard_threshold', 'starboard_emoji', 'starboard_selfstar',
  'counter_channel', 'leveling', 'levelup_channel',
  'nightwatch', 'confession_channel', 'bump_channel',
  // added in v2
  'punishment_presets', 'voiceguard', 'voiceban_role', 'scamshield', 'gambling_enabled',
];
const CONFIG_KEYS_SET = new Set(CONFIG_KEYS);

// deps (for tests): { store, rolepanels, tags }. Each needs the same small API as the real modules.
function buildExport(guild, deps = {}, now = new Date()) {
  const store = deps.store || require('../database/store');
  const config = {};
  for (const key of CONFIG_KEYS) {
    const value = store.getConfig(guild.id, key);
    if (value !== null && value !== undefined) config[key] = value;
  }
  let panels = [];
  let tags = [];
  try { panels = (deps.rolepanels || require('../database/rolepanels')).exportPanels(guild.id); } catch (err) { log.warn(`Backup export: panels skipped (${err.message})`); }
  try { tags = (deps.tags || require('../database/tags')).exportTags(guild.id); } catch (err) { log.warn(`Backup export: tags skipped (${err.message})`); }
  return {
    _meta: { guild: guild.name, exportedAt: now.toISOString(), version: EXPORT_VERSION },
    config,
    panels,
    tags,
  };
}

// Returns { ok, version, error }. Accepts v1 (config only) and v2.
function validateExport(data) {
  if (!data || typeof data !== 'object' || !data._meta || typeof data.config !== 'object' || data.config === null || Array.isArray(data.config)) {
    return { ok: false, error: 'not a mofu backup' };
  }
  const v = data._meta.version;
  if (v !== 1 && v !== EXPORT_VERSION) return { ok: false, error: 'unsupported backup version' };
  return { ok: true, version: v };
}

// Applies config keys and tags (existing tags are kept, never overwritten). Panels are exported for the record
// only: their messages live in Discord, so they are rebuilt with the panel commands, not auto-restored.
function applyImport(guildId, data, deps = {}) {
  const store = deps.store || require('../database/store');
  let applied = 0;
  const skippedKeys = [];
  for (const [key, value] of Object.entries(data.config)) {
    if (!CONFIG_KEYS_SET.has(key)) { skippedKeys.push(key); continue; }
    store.setConfig(guildId, key, value);
    applied++;
  }
  let tagsAdded = 0;
  let tagsSkipped = 0;
  if (Array.isArray(data.tags) && data.tags.length) {
    const tagsDb = deps.tags || require('../database/tags');
    const tu = require('./tags');
    for (const t of data.tags.slice(0, tu.LIMITS.perGuild)) {
      try {
        if (typeof t?.name !== 'string' || typeof t?.content !== 'string' || tu.nameError(t.name) || tu.contentError(t.content)) { tagsSkipped++; continue; }
        const r = tagsDb.createTag(guildId, { name: t.name, content: t.content, embed: !!t.embed });
        if (r === 'ok') tagsAdded++; else tagsSkipped++;
      } catch { tagsSkipped++; }
    }
  }
  return { applied, skippedKeys, tagsAdded, tagsSkipped, panelsInFile: Array.isArray(data.panels) ? data.panels.length : 0 };
}

// ---- optional second copy (BACKUP_COPY_DIR) ----
function copyDirFrom(env = process.env) {
  const d = (env.BACKUP_COPY_DIR || '').trim();
  return d || null;
}

// Copy one snapshot into the copy dir (tmp then rename), keep newest `keep`. Never throws.
function copySnapshot(file, copyDir, keep = KEEP) {
  try {
    fs.mkdirSync(copyDir, { recursive: true });
    const dest = path.join(copyDir, path.basename(file));
    if (!fs.existsSync(dest)) {
      const tmp = `${dest}.tmp`;
      fs.copyFileSync(file, tmp);
      fs.renameSync(tmp, dest);
    }
    prune(copyDir, keep);
    return dest;
  } catch (err) {
    log.warn(`Backup copy to BACKUP_COPY_DIR failed: ${err.message}`);
    return null;
  }
}

// If the newest local snapshot is missing from the copy dir (drive was away), copy it now. Never throws.
function syncCopy(dir, copyDir, keep = KEEP) {
  try {
    const newest = listBackups(dir)[0];
    if (!newest || fs.existsSync(path.join(copyDir, newest))) return null;
    return copySnapshot(path.join(dir, newest), copyDir, keep);
  } catch { return null; }
}

let lastBackupMs = null;
// Time of the newest snapshot (this process or the files on disk), or null. One small readdir.
function lastBackupAt(dir = DEFAULT_DIR) {
  const t = parseStamp(listBackups(dir)[0] || '');
  const best = Math.max(lastBackupMs || 0, t || 0);
  return best ? new Date(best).toISOString() : null;
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

function parseStamp(name) {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const [, ymd, hm] = m;
  const t = Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), +hm.slice(0, 2), +hm.slice(2, 4));
  return Number.isFinite(t) ? t : null;
}

// Backup files only (never touches anything else in the folder), newest first.
function listBackups(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => NAME_RE.test(n)).sort().reverse();
}

function prune(dir, keep = KEEP) {
  const removed = [];
  for (const name of listBackups(dir).slice(keep)) {
    try { fs.unlinkSync(path.join(dir, name)); removed.push(name); } catch (err) { log.warn(`Backup prune failed for ${name}: ${err.message}`); }
  }
  return removed;
}

// Write one snapshot now. Writes to a .tmp name first and renames, so a crash never leaves a half file that
// looks like a real backup. Returns the final path.
async function backupNow(db, { dir = DEFAULT_DIR, now = new Date(), keep = KEEP } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const final = path.join(dir, `sonder-${stamp(now)}.db`);
  const tmp = `${final}.tmp`;
  try { fs.unlinkSync(tmp); } catch { /* none */ }
  await db.backup(tmp);
  fs.renameSync(tmp, final);
  prune(dir, keep);
  lastBackupMs = now.getTime();
  return final;
}

function isDue(dir, nowMs = Date.now()) {
  const newest = listBackups(dir)[0];
  if (!newest) return true;
  const t = parseStamp(newest);
  return t === null || nowMs - t >= DAY_MS - 5 * 60 * 1000; // small slack so an hourly check does not drift a day
}

function disabled(env = process.env) {
  return env.BACKUPS === '0' || env.NODE_ENV === 'test' || !!env.NODE_TEST_CONTEXT;
}

let timer = null;
let running = false;

// Idempotent. Returns the interval handle (unref'd) or null when disabled.
function start({ db, dir = DEFAULT_DIR, env = process.env } = {}) {
  if (timer || disabled(env)) return timer;
  const handle = db || require('../database/store').db;
  const copyDir = copyDirFrom(env);
  const tick = async () => {
    if (running) return;
    if (!isDue(dir)) { if (copyDir) syncCopy(dir, copyDir); return; }
    running = true;
    try {
      const file = await backupNow(handle, { dir });
      log.info(`Backup written: ${path.basename(file)}`);
      if (copyDir) copySnapshot(file, copyDir);
    } catch (err) {
      log.error(`Backup failed: ${err.message}`);
    } finally {
      running = false;
    }
  };
  tick();
  timer = setInterval(tick, CHECK_MS);
  timer.unref();
  return timer;
}

function stop() { if (timer) clearInterval(timer); timer = null; }

module.exports = {
  start, stop, backupNow, prune, listBackups, isDue, stamp, parseStamp, disabled, KEEP,
  copyDirFrom, copySnapshot, syncCopy, lastBackupAt,
  EXPORT_VERSION, CONFIG_KEYS, buildExport, validateExport, applyImport,
};
