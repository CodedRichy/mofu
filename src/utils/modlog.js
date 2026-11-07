const store = require('../database/store');
const { modAction } = require('./embed');
const { colors } = require('./constants');
const log = require('./logger');

const actionColors = {
  ban: colors.error,
  tempban: colors.error,
  unban: colors.success,
  kick: colors.warning,
  mute: colors.warning,
  unmute: colors.success,
  warn: colors.warning,
  clearwarns: colors.info,
  lock: colors.muted,
  unlock: colors.success,
  purge: colors.info,
  softban: colors.error,
};

// Logged but not numbered: moving someone between voice channels is not a punishment.
const NO_CASE = new Set(['drag']);

// Allocate the next case number for this guild. Never throws: a broken case table must not stop the action.
function openCase(guild, { action, target, moderator, reason, duration }) {
  try {
    return require('../database/infractions').openCase({
      guildId: guild.id,
      action,
      targetId: target?.id,
      targetTag: target?.tag || target?.user?.tag || null,
      moderatorId: moderator?.id,
      moderatorTag: moderator?.tag || null,
      reason,
      duration,
    });
  } catch (err) {
    log.warn(`case allocation failed: ${err.message}`);
    return null;
  }
}

function voidCase(guild, caseId, note) {
  try { return require('../database/infractions').voidCase(guild.id, caseId, note); } catch { return false; }
}

// Posts the modlog embed and returns the case number. Every user-targeted action gets a case even when no modlog
// channel is set. Pass `caseId` when the caller already opened one (to show it in a DM first); null = no case.
async function send(guild, { action, target, moderator, reason, extra, duration, caseId }) {
  let id = caseId;
  if (id === undefined) id = NO_CASE.has(String(action).toLowerCase()) ? null : openCase(guild, { action, target, moderator, reason, duration });

  const channelId = store.getConfig(guild.id, 'modlog_channel');
  if (!channelId) return id;

  const channel = guild.channels.cache.get(channelId);
  if (!channel) return id;

  const embed = modAction({
    client: guild.client,
    action,
    color: actionColors[String(action).toLowerCase()] || colors.primary,
    target,
    moderator,
    reason,
    duration,
    extra,
    caseId: id,
  });

  const msg = await channel.send({ embeds: [embed] }).catch(() => null);
  if (msg && id) {
    try { require('../database/infractions').attachLogMessage(guild.id, id, channel.id, msg.id); } catch { /* ignore */ }
  }
  return id;
}

module.exports = { send, openCase, voidCase };
