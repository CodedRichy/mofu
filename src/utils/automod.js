// Content automod shared by messageCreate and messageUpdate: links, invites, word filter, mass mentions, caps,
// plus the per-trigger punishment ladder (/automod rule). No AI calls on this path: it runs on every message.
// The database is required lazily so the ladder can be exercised with fake objects.
const { response, dmNotice } = require('./embed');
const { colors } = require('./constants');
const { hasBlockedLink } = require('./linkfilter');
const rules = require('./automodRules');
const { format } = require('./duration');

const db = () => require('../database/store');

// ids of messages the bot deleted itself; snipe must not resurrect them
const botDeleted = new Map();
function markBotDeleted(id) {
  botDeleted.set(id, Date.now());
  if (botDeleted.size > 500) {
    const cutoff = Date.now() - 60000;
    for (const [k, t] of botDeleted) if (t < cutoff) botDeleted.delete(k);
  }
}
function wasBotDeleted(id) { return botDeleted.has(id); }

// Strikes live in memory only (a restart forgives), bounded by age and count.
const strikes = new rules.StrikeCounter();
setInterval(() => strikes.sweep(), 60000).unref();

function getRules(guildId) {
  return rules.normalizeRules(db().getConfig(guildId, 'automod_rules'));
}
function spamRule(guildId) {
  return getRules(guildId).spam || null;
}

const NOTICES = {
  links: 'links are not allowed here.',
  invites: 'invite links are not allowed here.',
  badwords: 'that word is not allowed here.',
  mentions: 'too many mentions in one message.',
  caps: 'please ease up on the caps.',
  spam: 'slow down, that is spam.',
};

// Returns { type, trigger, notice } or null. `type` keeps the old names ('antilink', 'wordfilter').
function checkContent(guildId, content) {
  if (!content) return null;
  const store = db();
  const active = getRules(guildId);
  if (active.invites && rules.hasInvite(content)) return { type: 'invites', trigger: 'invites', notice: NOTICES.invites };
  if (store.getConfig(guildId, 'antilink') || active.links) {
    const whitelist = store.getConfig(guildId, 'antilink_whitelist') || [];
    if (hasBlockedLink(content, whitelist)) return { type: 'antilink', trigger: 'links', notice: NOTICES.links };
  }
  const wordFilter = store.getConfig(guildId, 'word_filter');
  if (wordFilter?.length) {
    const lower = content.toLowerCase();
    if (wordFilter.find((w) => lower.includes(String(w).toLowerCase()))) return { type: 'wordfilter', trigger: 'badwords', notice: NOTICES.badwords };
  }
  if (active.mentions && rules.isMassMention(content)) return { type: 'mentions', trigger: 'mentions', notice: NOTICES.mentions };
  if (active.caps && rules.isCapsHeavy(content)) return { type: 'caps', trigger: 'caps', notice: NOTICES.caps };
  return null;
}

function flash(message, text) {
  message.channel.send({ embeds: [response({ client: message.client, description: text, color: colors.error })], allowedMentions: { parse: [] } })
    .then((m) => setTimeout(() => m.delete().catch(() => {}), 5000)).catch(() => {});
}

// What the bot can actually do to this member, falling back down the ladder when it lacks rank or permission.
function feasible(step, member, guild) {
  if (!member || member.id === guild.ownerId) return { kind: step.kind === 'delete' ? 'delete' : 'warn' };
  if (step.kind === 'ban' && !member.bannable) step = { kind: 'kick' };
  if (step.kind === 'kick' && !member.kickable) step = { kind: 'timeout', ms: rules.DEFAULT_TIMEOUT_MIN * 60000 };
  if (step.kind === 'timeout' && !member.moderatable) step = { kind: 'warn' };
  return step;
}

// Apply the next ladder step for `trigger` after the offending message was removed. Never throws.
// deps (for tests): { store, modlog, strikes }
async function punish(message, trigger, rawRule, deps = {}) {
  try {
    const rule = rules.normalizeRule(rawRule); // fills timeout/window defaults; a NaN window would never count strikes
    if (!rule) return null;
    const store = deps.store || db();
    const modlog = deps.modlog || require('./modlog');
    const counter = deps.strikes || strikes;
    const { guild, member, author: user } = message;
    const bot = message.client.user;
    const key = `${guild.id}:${user.id}:${trigger}`;
    const strike = counter.hit(key, rule.windowMin * 60000);
    const step = feasible(rules.ladderStep(rule, strike), member, guild);
    const label = rules.LABELS[trigger] || trigger;
    const reason = `Automod: ${label} (strike ${strike})`;
    const notice = NOTICES[trigger] || 'that is not allowed here.';

    if (step.kind === 'delete') {
      flash(message, `${user}, ${notice}`);
      return { strike, kind: 'delete', caseId: null };
    }

    const dur = step.ms ? format(step.ms) : null;
    const caseAction = step.kind === 'timeout' ? 'mute' : step.kind;
    const verb = { warn: 'warned', timeout: 'muted', kick: 'kicked', ban: 'banned' }[step.kind];
    if (step.kind === 'warn') store.addWarning(guild.id, user.id, { reason, moderatorId: bot.id });
    const caseId = modlog.openCase(guild, { action: caseAction, target: user, moderator: bot, reason, duration: dur });
    const dm = () => user.send({ embeds: [dmNotice({ guild, action: verb, reason, color: colors.warning, duration: dur, caseId })] }).catch(() => {});

    try {
      if (step.kind === 'timeout') { await member.timeout(step.ms, reason); await dm(); }
      else if (step.kind === 'kick') { await dm(); await member.kick(reason); }
      else if (step.kind === 'ban') { await dm(); await guild.members.ban(user.id, { reason, deleteMessageSeconds: 3600 }); }
      else await dm();
    } catch {
      modlog.voidCase(guild, caseId, 'Discord refused');
      flash(message, `${user}, ${notice}`);
      return { strike, kind: 'delete', caseId: null };
    }

    if (step.kind === 'kick' || step.kind === 'ban') counter.reset(key);
    await modlog.send(guild, { action: caseAction, target: user, moderator: bot, reason, duration: dur, caseId, extra: `Strike ${strike} within ${rule.windowMin}m` }).catch(() => {});
    const tail = { warn: 'This is a warning.', timeout: `Muted for **${dur}**.`, kick: 'Kicked.', ban: 'Banned.' }[step.kind];
    flash(message, `${user}, ${notice} ${tail}`);
    return { strike, kind: step.kind, caseId };
  } catch {
    return null;
  }
}

// Run the checks on a message and delete it on a hit. Returns true when it was removed.
function enforce(message, content = message.content) {
  const member = message.member;
  if (!member || member.permissions.has('ManageMessages')) return false;
  const hit = checkContent(message.guild.id, content);
  if (!hit) return false;
  markBotDeleted(message.id);
  message.delete().catch(() => {});
  const rule = getRules(message.guild.id)[hit.trigger];
  if (rule) punish(message, hit.trigger, rule).catch(() => {});
  else flash(message, `${message.author}, ${hit.notice}`);
  return true;
}

// Called by messageCreate's spam detector when a 'spam' rule is set: clear the burst, then climb the ladder.
async function enforceSpam(message, burst = 5) {
  try {
    const rule = spamRule(message.guild.id);
    if (!rule) return false;
    const msgs = await message.channel.messages.fetch({ limit: Math.min(Math.max(burst, 1), 50) }).catch(() => null);
    const own = msgs ? msgs.filter((m) => m.author.id === message.author.id) : null;
    if (own?.size) {
      for (const id of own.keys()) markBotDeleted(id);
      await message.channel.bulkDelete(own).catch(() => {});
    }
    await punish(message, 'spam', rule);
    return true;
  } catch {
    return false;
  }
}

module.exports = { checkContent, enforce, enforceSpam, punish, spamRule, getRules, markBotDeleted, wasBotDeleted, _strikes: strikes };
