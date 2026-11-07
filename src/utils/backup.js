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
  const tick = async () => {
    if (running || !isDue(dir)) return;
    running = true;
    try {
      const file = await backupNow(handle, { dir });
      log.info(`Backup written: ${path.basename(file)}`);
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

module.exports = { start, stop, backupNow, prune, listBackups, isDue, stamp, parseStamp, disabled, KEEP };
