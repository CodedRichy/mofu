// Warn thresholds: "at 3 warnings mute 1h, at 5 kick, at 7 ban 7d". Stored in config 'warn_thresholds' as
// [{ count, action, durationMs }]; optional 'warn_expiry_days' makes old warnings stop counting.
// The pure helpers take plain data so they are testable; applyThreshold takes injectable deps and never throws.

const { PermissionFlagsBits } = require('discord.js');
const { parse, format } = require('./duration');
const { memberProblem } = require('./modguard');

const ACTIONS = ['mute', 'kick', 'ban', 'none'];
const MAX_THRESHOLDS = 10;
const MAX_COUNT = 100;
const MAX_EXPIRY_DAYS = 365;
const MUTE_DEFAULT_MS = 3600000; // 1h
const MUTE_MAX_MS = 28 * 86400000; // Discord's timeout ceiling
const BAN_MAX_MS = 365 * 86400000;
const DAY_MS = 86400000;

// Returns { error } or { value: { count, action, durationMs } }.
function validateThreshold({ count, action, duration }) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) return { error: `Count must be a whole number from 1 to ${MAX_COUNT}.` };
  const a = String(action || '').toLowerCase();
  if (!ACTIONS.includes(a)) return { error: `Action must be one of: ${ACTIONS.join(', ')}.` };
  let durationMs = null;
  if (duration) {
    if (a !== 'mute' && a !== 'ban') return { error: 'Only mute and ban take a duration.' };
    durationMs = parse(String(duration).trim());
    if (!durationMs || durationMs <= 0) return { error: 'Invalid duration. Use: `30m`, `1h`, `1d`, `1w`.' };
    if (a === 'mute' && durationMs > MUTE_MAX_MS) return { error: 'Mute duration cannot exceed 28 days.' };
    if (a === 'ban' && durationMs > BAN_MAX_MS) return { error: 'Ban duration cannot exceed 365 days (leave it empty for a permanent ban).' };
    if (durationMs < 60000) return { error: 'Duration must be at least 1 minute.' };
  }
  if (a === 'mute' && !durationMs) durationMs = MUTE_DEFAULT_MS;
  return { value: { count, action: a, durationMs } };
}

// Whatever is stored, hand back a clean, de-duplicated, ascending list (bad rows dropped, never throws).
function normalizeThresholds(raw) {
  if (!Array.isArray(raw)) return [];
  const byCount = new Map();
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const v = validateThreshold({ count: t.count, action: t.action });
    if (v.error) continue;
    let ms = Number.isFinite(t.durationMs) && t.durationMs > 0 ? t.durationMs : v.value.durationMs;
    if (v.value.action === 'mute') ms = Math.min(ms || MUTE_DEFAULT_MS, MUTE_MAX_MS);
    else if (v.value.action === 'ban') ms = ms ? Math.min(ms, BAN_MAX_MS) : null;
    else ms = null;
    byCount.set(v.value.count, { count: v.value.count, action: v.value.action, durationMs: ms });
  }
  return [...byCount.values()].sort((a, b) => a.count - b.count).slice(0, MAX_THRESHOLDS);
}

function normalizeExpiryDays(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n <= MAX_EXPIRY_DAYS ? n : null;
}

function isActive(warning, expiryDays, now = Date.now()) {
  const days = normalizeExpiryDays(expiryDays);
  if (!days) return true;
  const t = new Date(warning?.timestamp).getTime();
  if (!Number.isFinite(t)) return true; // unknown date: keep counting rather than silently forgive
  return now - t < days * DAY_MS;
}

function countActive(warnings, expiryDays, now = Date.now()) {
  if (!Array.isArray(warnings)) return 0;
  return warnings.filter((w) => isActive(w, expiryDays, now)).length;
}

// Exact-count match: a threshold fires only when the active count equals it (3=mute, 5=kick: the 4th warning
// does nothing extra). If expiry drops someone below a threshold and they reach it again, it fires again.
// 'none' entries are real matches (they deliberately do nothing).
function pickThreshold(thresholds, activeCount) {
  return normalizeThresholds(thresholds).find((t) => t.count === activeCount) || null;
}

function describe(t) {
  if (!t) return 'nothing';
  if (t.action === 'none') return 'no action';
  if (t.action === 'mute') return `mute ${format(t.durationMs)}`;
  if (t.action === 'ban') return t.durationMs ? `ban ${format(t.durationMs)}` : 'ban (permanent)';
  return t.action;
}

// Why the bot must not carry out `action` on `user` / `member`, or null. invoker = the moderator who warned.
function blocker(guild, { action, user, member, invoker }) {
  if (user.id === guild.ownerId) return 'they own the server';
  if (user.id === guild.client?.user?.id) return 'that is me';
  if (action === 'mute' || action === 'kick') {
    if (!member) return 'they are not in the server';
    if (action === 'mute' && !member.moderatable) return 'their role is above mine or I lack Timeout Members';
    if (action === 'kick' && !member.kickable) return 'their role is above mine or I lack Kick Members';
  }
  if (action === 'ban') {
    if (member && !member.bannable) return 'their role is above mine or I lack Ban Members';
    if (!member && !guild.members?.me?.permissions?.has(PermissionFlagsBits.BanMembers)) return 'I lack Ban Members';
  }
  // A moderator must not be able to warn someone above them into a punishment they could not give directly.
  if (member && invoker && invoker.roles && member.roles) {
    const p = memberProblem(guild, invoker, member, action);
    if (p) return p.replace(/^You can't/, 'the warning moderator can\'t').replace(/\.$/, '');
  }
  return null;
}

// Apply the threshold reached by `count` active warnings. Returns { applied, text, caseId } and never throws.
// deps (for tests): { modlog, infractions, dm(user, payload) }.
async function applyThreshold({ guild, user, invoker, count, threshold, deps = {} }) {
  if (!threshold || threshold.action === 'none') return { applied: false, text: null, caseId: null };
  const modlog = deps.modlog || require('./modlog');
  const reason = `Auto: ${count} warnings`;
  const me = guild.client?.user;
  const { action, durationMs } = threshold;
  let caseId = null;
  try {
    const member = guild.members.cache.get(user.id) || await guild.members.fetch(user.id).catch(() => null);
    const why = blocker(guild, { action, user, member, invoker });
    if (why) return { applied: false, text: `Threshold reached (${count}): skipped ${describe(threshold)} because ${why}.`, caseId: null };

    const { dmNotice } = require('./embed');
    const { colors } = require('./constants');
    const dm = deps.dm || ((u, payload) => u.send(payload).catch(() => {}));
    const dur = durationMs ? format(durationMs) : null;
    const caseAction = action === 'ban' && durationMs ? 'tempban' : action;
    const verb = { mute: 'muted', kick: 'kicked', ban: 'banned' }[action];

    caseId = modlog.openCase(guild, { action: caseAction, target: user, moderator: me, reason, duration: dur });
    const notice = { embeds: [dmNotice({ guild, action: verb, reason, color: action === 'ban' ? colors.error : colors.warning, duration: dur, caseId })] };

    if (action === 'mute') {
      await member.timeout(durationMs, reason);
      await dm(user, notice);
    } else if (action === 'kick') {
      await dm(user, notice); // no shared server afterwards
      await member.kick(reason);
    } else {
      await dm(user, notice);
      await guild.members.ban(user.id, { reason });
      if (durationMs) {
        const infractions = deps.infractions || require('../database/infractions');
        infractions.addTempban({ guildId: guild.id, userId: user.id, userTag: user.tag, expiresAt: Date.now() + durationMs, caseId, moderatorId: me?.id });
      }
    }

    await modlog.send(guild, { action: caseAction, target: user, moderator: me, reason, duration: dur, caseId });
    const tag = caseId ? ` (case #${caseId})` : '';
    return { applied: true, text: `Threshold reached (${count}): ${describe(threshold)}${tag}.`, caseId };
  } catch (err) {
    if (caseId) modlog.voidCase?.(guild, caseId, 'Discord refused');
    return { applied: false, text: `Threshold reached (${count}) but ${describe(threshold)} failed: ${String(err?.message || err).slice(0, 120)}.`, caseId: null };
  }
}

module.exports = {
  ACTIONS, MAX_THRESHOLDS, MAX_EXPIRY_DAYS, MUTE_DEFAULT_MS,
  validateThreshold, normalizeThresholds, normalizeExpiryDays, isActive, countActive, pickThreshold, describe, blocker, applyThreshold,
};
