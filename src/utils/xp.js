// Leveling rules shared by message XP, voice XP and the leveling commands: level role rewards, XP multipliers,
// no-XP lists and level-up announcements.
// The pure helpers at the top take plain data and never touch Discord or the database, so they unit-test cleanly.
// store / xp db / logger are required lazily (or injected via `deps`) so tests never open data/sonder.db.

const LIMITS = {
  REWARDS_MAX: 25, // level role rewards per guild
  MULT_MIN: 0.1, // per role / channel / global multiplier set by commands
  MULT_MAX: 5,
  TOTAL_MULT_MAX: 10, // role x channel x global never exceeds this
  MULTS_MAX: 25, // role multipliers per guild, and channel multipliers per guild
  IGNORE_MAX: 100, // no-XP channels per guild, and no-XP roles per guild (matches the dashboard schema)
  MESSAGE_MAX: 300, // custom level-up message template
  VOICE_RATE_DEFAULT: 5,
  VOICE_RATE_MAX: 50,
  AWARD_MAX: 500, // one award never exceeds this, whatever the config says
};

// Config keys. level_roles / xp_multiplier / no_xp_channels / no_xp_roles are the keys the dashboard already writes.
const KEYS = {
  rewards: 'level_roles', // [{ level, role }]
  mode: 'levelrole_mode', // 'stack' | 'replace'
  global: 'xp_multiplier', // number
  roleMults: 'xp_role_multipliers', // { roleId: number }
  channelMults: 'xp_channel_multipliers', // { channelId: number }
  ignoreChannels: 'no_xp_channels', // [channelId]
  ignoreRoles: 'no_xp_roles', // [roleId]
  voiceEnabled: 'voicexp_enabled', // boolean, default false
  voiceRate: 'voicexp_rate', // integer XP per minute
  announce: 'levelup_announce', // boolean, default true
  message: 'levelup_message', // template string or null
  channel: 'levelup_channel', // channel id or null
};

const SNOWFLAKE = /^\d{17,20}$/;
const isSnowflake = (v) => typeof v === 'string' && SNOWFLAKE.test(v);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------------------------------------------------------------- pure helpers

// Valid reward entries only, one entry per role (lowest level wins), sorted by level then role id.
// Accepts { role } (dashboard) and { roleId } shapes.
function normalizeRewards(raw) {
  if (!Array.isArray(raw)) return [];
  const byRole = new Map();
  for (const e of raw) {
    if (!isPlainObject(e)) continue;
    const role = e.role ?? e.roleId;
    const level = e.level;
    if (!isSnowflake(role) || !Number.isSafeInteger(level) || level < 0 || level > 1000) continue;
    const prev = byRole.get(role);
    if (!prev || level < prev.level) byRole.set(role, { level, role });
  }
  return [...byRole.values()].sort((a, b) => a.level - b.level || (a.role < b.role ? -1 : 1));
}

function normalizeMode(v) {
  return v === 'replace' ? 'replace' : 'stack';
}

// Which reward roles to add / remove for a member at `level` who currently holds `held` (Set or array of role ids).
// stack:   every reward at or below the level; never removes anything.
// replace: only the reward(s) at the highest earned reward level; other reward roles the member holds are removed.
function selectRewardChanges(rewards, level, held, mode) {
  const has = held instanceof Set ? held : new Set(held || []);
  const list = normalizeRewards(rewards);
  const earned = list.filter((r) => r.level <= level);
  let want = earned;
  if (normalizeMode(mode) === 'replace') {
    const top = earned.length ? earned[earned.length - 1].level : null;
    want = top === null ? [] : earned.filter((r) => r.level === top);
  }
  const wantIds = new Set(want.map((r) => r.role));
  const add = [...wantIds].filter((id) => !has.has(id));
  const remove = normalizeMode(mode) === 'replace'
    ? list.map((r) => r.role).filter((id) => !wantIds.has(id) && has.has(id))
    : [];
  return { add, remove };
}

// Why the bot cannot hand out `role` as a reward, or null. Checked when a reward is added AND every time it is granted
// (the role may have moved above the bot, become managed, or been deleted since).
function rewardRoleProblem(guild, role) {
  if (!role) return 'That role no longer exists.';
  if (role.id === guild.id) return "@everyone can't be a reward.";
  if (role.managed) return 'That role is managed by an integration (a bot or booster role) and cannot be assigned.';
  if (!role.editable) return "I can't assign that role: it is at or above my highest role, or I lack Manage Roles.";
  return null;
}

// A multiplier value from config, or null when it is missing / junk / out of range.
function validMult(v, min = LIMITS.MULT_MIN, max = LIMITS.MULT_MAX) {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
}

// Channel ids from most to least specific: the channel, its parent (thread -> channel, channel -> category),
// and the grandparent (thread -> category).
function channelChain(channel) {
  if (!channel) return [];
  const ids = [channel.id, channel.parentId, channel.parent?.parentId];
  return [...new Set(ids.filter(Boolean))];
}

// Stack rule: highest matching role multiplier x most specific channel multiplier x global, capped at 10.
// Missing parts count as 1. Global comes from the dashboard too, which allows 0 (no XP at all), so it accepts 0-10.
function computeMultiplier({ roleIds = [], channelIds = [], roleMults = {}, channelMults = {}, global } = {}) {
  const rm = isPlainObject(roleMults) ? roleMults : {};
  const cm = isPlainObject(channelMults) ? channelMults : {};
  const roleVals = roleIds.map((id) => validMult(rm[id])).filter((v) => v !== null);
  const roleM = roleVals.length ? Math.max(...roleVals) : 1;
  let chM = 1;
  for (const id of channelIds) {
    const v = validMult(cm[id]);
    if (v !== null) { chM = v; break; }
  }
  const g = validMult(global, 0, LIMITS.TOTAL_MULT_MAX);
  const total = roleM * chM * (g === null ? 1 : g);
  return Math.round(Math.min(LIMITS.TOTAL_MULT_MAX, total) * 1000) / 1000;
}

function isIgnored({ roleIds = [], channelIds = [], ignoreChannels = [], ignoreRoles = [] } = {}) {
  const ch = new Set(Array.isArray(ignoreChannels) ? ignoreChannels : []);
  const ro = new Set(Array.isArray(ignoreRoles) ? ignoreRoles : []);
  return channelIds.some((id) => ch.has(id)) || roleIds.some((id) => ro.has(id));
}

// XP actually awarded for a base amount: 0 when the multiplier is 0, otherwise at least 1 and at most AWARD_MAX.
function scaledAmount(base, mult) {
  if (!(base > 0) || !(mult > 0)) return 0;
  return Math.max(1, Math.min(LIMITS.AWARD_MAX, Math.round(base * mult)));
}

// Clean a level-up message template typed by an admin: { value } or { error }.
function cleanTemplate(input) {
  if (typeof input !== 'string') return { error: 'Give the message text.' };
  // eslint-disable-next-line no-control-regex
  const s = input.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim();
  if (!s.length) return { error: 'The message is empty.' };
  if (s.length > LIMITS.MESSAGE_MAX) return { error: `The message is too long (max ${LIMITS.MESSAGE_MAX} characters).` };
  return { value: s };
}

// Fill {user} {level} {server}. @everyone / @here are defused in the text as well as by allowedMentions at send time.
function renderLevelUpMessage(template, { userId, level, serverName }) {
  const out = String(template)
    .replace(/\{user\}/gi, `<@${userId}>`)
    .replace(/\{level\}/gi, String(level))
    .replace(/\{server\}/gi, String(serverName ?? ''))
    .replace(/@(everyone|here)/gi, '@​$1');
  return out.length > 2000 ? `${out.slice(0, 1997)}...` : out;
}

// Parse a free-text target: a role mention, channel mention, raw id, the word "global", or a level number.
function parseTarget(raw) {
  const s = String(raw ?? '').trim();
  let m;
  if ((m = /^<@&(\d{17,20})>$/.exec(s))) return { type: 'role', id: m[1] };
  if ((m = /^<#(\d{17,20})>$/.exec(s))) return { type: 'channel', id: m[1] };
  if (SNOWFLAKE.test(s)) return { type: 'id', id: s };
  if (/^global$/i.test(s)) return { type: 'global' };
  if (/^\d{1,4}$/.test(s)) return { type: 'level', level: Number(s) };
  return { type: null };
}

// Voice XP eligibility for one voice channel's states (plain objects or discord.js VoiceStates).
// Not the AFK channel; humans only; not self/server deafened, not server muted, not timed out; at least 2 such people.
function eligibleVoiceMembers(states, { afkChannelId } = {}) {
  const list = [...states];
  if (!list.length || (afkChannelId && list[0].channelId === afkChannelId)) return [];
  const active = list.filter((s) => {
    const m = s.member;
    if (!m || m.user?.bot) return false;
    if (s.selfDeaf || s.serverDeaf || s.deaf || s.serverMute) return false;
    if (typeof m.isCommunicationDisabled === 'function' && m.isCommunicationDisabled()) return false;
    return true;
  });
  return active.length >= 2 ? active.map((s) => s.member) : [];
}

function voiceRate(v) {
  return Number.isSafeInteger(v) && v >= 1 ? Math.min(v, LIMITS.VOICE_RATE_MAX) : LIMITS.VOICE_RATE_DEFAULT;
}

// ---------------------------------------------------------------- config + side effects

function resolveDeps(deps = {}) {
  return {
    store: deps.store || require('../database/store'),
    xpDb: deps.xpDb || require('../database/xp'),
    log: deps.log || require('./logger'),
  };
}

function readConfig(guildId, store) {
  const g = (k) => store.getConfig(guildId, k);
  return {
    enabled: g('leveling') ?? true,
    rewards: normalizeRewards(g(KEYS.rewards)),
    mode: normalizeMode(g(KEYS.mode)),
    global: g(KEYS.global),
    roleMults: g(KEYS.roleMults) || {},
    channelMults: g(KEYS.channelMults) || {},
    ignoreChannels: g(KEYS.ignoreChannels) || [],
    ignoreRoles: g(KEYS.ignoreRoles) || [],
  };
}

// Bring a member's reward roles in line with `level`. Never throws: every failure is logged and counted.
// Roles are added / removed one at a time (PUT/DELETE per role), never via a full role-list PATCH, so a partial
// member cache can't wipe roles.
async function applyLevelRoles(member, level, deps = {}) {
  const out = { added: [], removed: [], failed: [] };
  try {
    const { store, log } = resolveDeps(deps);
    const guild = member.guild;
    const cfg = deps.config || readConfig(guild.id, store);
    if (!cfg.rewards.length) return out;
    const held = new Set(member.roles.cache.keys());
    const { add, remove } = selectRewardChanges(cfg.rewards, level, held, cfg.mode);
    const run = async (ids, verb) => {
      for (const id of ids) {
        const role = guild.roles.cache.get(id);
        const problem = rewardRoleProblem(guild, role);
        if (problem) {
          out.failed.push({ id, reason: problem });
          log.warn(`Level reward ${verb} skipped in ${guild.id} (role ${id}): ${problem}`);
          continue;
        }
        try {
          await member.roles[verb](id, `Level reward (level ${level})`);
          (verb === 'add' ? out.added : out.removed).push(id);
        } catch (err) {
          out.failed.push({ id, reason: err?.message || 'request failed' });
          log.warn(`Level reward ${verb} failed in ${guild.id} (role ${id}, member ${member.id}): ${err?.message || err}`);
        }
      }
    };
    await run(add, 'add');
    await run(remove, 'remove');
  } catch (err) {
    try { (deps.log || require('./logger')).warn('applyLevelRoles failed:', err?.message || err); } catch { /* ignore */ }
  }
  return out;
}

// Post the level-up announcement. `fallback` is where it goes when no level-up channel is set (the message's
// channel for message XP; null for voice XP, so voice level-ups only post when a channel is configured).
async function announceLevelUp({ guild, user, oldLevel, newLevel, result, fallback }, deps = {}) {
  try {
    const { store } = resolveDeps(deps);
    if ((store.getConfig(guild.id, KEYS.announce) ?? true) === false) return false;
    const channelId = store.getConfig(guild.id, KEYS.channel);
    const target = channelId ? guild.channels.cache.get(channelId) : fallback;
    if (!target || typeof target.send !== 'function') return false;
    const me = guild.members?.me;
    const perms = me && typeof target.permissionsFor === 'function' ? target.permissionsFor(me) : null;
    if (perms && !perms.has(['ViewChannel', 'SendMessages'])) return false;

    const template = store.getConfig(guild.id, KEYS.message);
    if (typeof template === 'string' && template.trim()) {
      const content = renderLevelUpMessage(template, { userId: user.id, level: newLevel, serverName: guild.name });
      await target.send({ content, allowedMentions: { parse: [], users: [user.id] } });
    } else {
      const { levelUpEmbed } = require('./visuals');
      const embed = levelUpEmbed({ client: guild.client, user, oldLevel, newLevel, xpPct: result?.needed ? result.xp / result.needed : 0 });
      await target.send({ embeds: [embed], allowedMentions: { parse: [] } });
    }
    return true;
  } catch {
    return false;
  }
}

// Award `base` XP to `member`, applying no-XP lists and multipliers; grant rewards + announce on level-up.
// `channel` is where the XP was earned (text or voice). Returns the addXp result, or null when nothing was awarded.
// `cooldownMs` (message XP only) is checked after the no-XP lists so ignored channels don't burn the cooldown.
async function awardXp({ member, channel, base, cooldownMs, fallback }, deps = {}) {
  const { store, xpDb } = resolveDeps(deps);
  const guild = member.guild;
  const cfg = readConfig(guild.id, store);
  if (!cfg.enabled) return null;
  const roleIds = [...member.roles.cache.keys()];
  const channelIds = channelChain(channel);
  if (isIgnored({ roleIds, channelIds, ignoreChannels: cfg.ignoreChannels, ignoreRoles: cfg.ignoreRoles })) return null;
  const mult = computeMultiplier({ roleIds, channelIds, roleMults: cfg.roleMults, channelMults: cfg.channelMults, global: cfg.global });
  const amount = scaledAmount(base, mult);
  if (!amount) return null;
  if (cooldownMs && !xpDb.canEarnXp(guild.id, member.id, cooldownMs)) return null;

  const before = xpDb.getStats(guild.id, member.id).level;
  const result = xpDb.addXp(guild.id, member.id, amount);
  if (result.leveledUp) {
    await applyLevelRoles(member, result.level, { ...deps, config: cfg });
    await announceLevelUp({ guild, user: member.user, oldLevel: before, newLevel: result.level, result, fallback }, deps);
  }
  return { ...result, amount, multiplier: mult };
}

// messageCreate entry point. Never throws.
async function handleMessageXp(message, { min = 15, max = 25, cooldown = 60000 } = {}, deps = {}) {
  try {
    if (!message.member || !message.guild) return null;
    const base = Math.floor(Math.random() * (max - min + 1)) + min;
    return await awardXp({ member: message.member, channel: message.channel, base, cooldownMs: cooldown, fallback: message.channel }, deps);
  } catch (err) {
    try { (deps.log || require('./logger')).warn('Message XP failed:', err?.message || err); } catch { /* ignore */ }
    return null;
  }
}

module.exports = {
  LIMITS, KEYS,
  normalizeRewards, normalizeMode, selectRewardChanges, rewardRoleProblem, validMult, channelChain,
  computeMultiplier, isIgnored, scaledAmount, cleanTemplate, renderLevelUpMessage, parseTarget,
  eligibleVoiceMembers, voiceRate, readConfig,
  applyLevelRoles, announceLevelUp, awardXp, handleMessageXp,
};
