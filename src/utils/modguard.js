// Small shared helpers for moderation commands: text clipping, role-hierarchy checks, and a channel-appropriate
// modlog post (modlog.send/modAction assume the target is a user).
// store and embed are required lazily so the pure helpers can be unit-tested without opening the database.

const REASON_MAX = 512; // Discord's audit-log reason limit

function clip(s, n) {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, Math.max(0, n - 3))}...` : t;
}

// Join lines with a separator without ever exceeding `max` characters; says how many were left out.
function joinClipped(lines, max, sep = '\n') {
  const out = [];
  let len = 0;
  for (let i = 0; i < lines.length; i++) {
    const add = (out.length ? sep.length : 0) + lines[i].length;
    const reserve = i < lines.length - 1 ? sep.length + `...and ${lines.length - i} more`.length : 0;
    if (len + add + reserve > max) {
      if (!out.length) return clip(lines[i], max);
      return `${out.join(sep)}${sep}...and ${lines.length - i} more`;
    }
    out.push(lines[i]);
    len += add;
  }
  return out.join(sep);
}

// Warnings store a moderator id, notes store a tag; show a mention for ids so it never prints a raw snowflake.
function modLabel(m) {
  if (!m) return 'unknown';
  return /^\d{15,25}$/.test(String(m)) ? `<@${m}>` : clip(String(m).replace(/[`*_~|>]/g, ''), 40);
}

function reasonError(reason) {
  return reason && reason.length > REASON_MAX
    ? `Reason is too long (max ${REASON_MAX} characters, Discord's audit-log limit).`
    : null;
}

// Why `invoker` (GuildMember) may not hand out / take away `role`, or null if fine. The bot must also be able to.
function roleProblem(guild, invoker, role) {
  if (!role) return 'That role no longer exists.';
  if (role.id === guild.id) return "You can't use @everyone here.";
  if (role.managed) return 'That role is managed by an integration and cannot be assigned.';
  if (guild.ownerId !== invoker.id && role.position >= invoker.roles.highest.position) {
    return 'That role is at or above your highest role.';
  }
  if (!role.editable) return "I can't manage that role (it is at or above my highest role, or I lack Manage Roles).";
  return null;
}

// Why `invoker` may not act on member `target`, or null. Owner bypasses rank; the bot still needs `manageable`.
function memberProblem(guild, invoker, target, verb = 'manage') {
  if (target.id === guild.ownerId && target.id !== invoker.id) return `You can't ${verb} the server owner.`;
  if (guild.ownerId !== invoker.id && target.id !== invoker.id
    && target.roles.highest.position >= invoker.roles.highest.position) {
    return `You can't ${verb} someone with a higher or equal role.`;
  }
  if (!target.manageable) return `I can't ${verb} that member (their role is above mine, or I'm missing a permission).`;
  return null;
}

// For jail/hardmute: roles the bot can take off (saved) vs ones that must stay (managed / above the bot).
function splitRoles(guild, member) {
  const saved = [];
  const kept = [];
  for (const r of member.roles.cache.values()) {
    if (r.id === guild.id) continue;
    if (r.managed || !r.editable) kept.push(r.id);
    else saved.push(r.id);
  }
  return { saved, kept };
}

// Roles to put back on release: whatever the member holds now (minus the punishment role) plus saved roles that
// still exist and the bot can still grant.
function restorableRoles(guild, member, savedIds, dropId) {
  const keep = new Set();
  for (const r of member.roles.cache.values()) if (r.id !== guild.id && r.id !== dropId) keep.add(r.id);
  for (const id of savedIds || []) {
    const r = guild.roles.cache.get(id);
    if (r && !r.managed && r.editable && id !== dropId) keep.add(id);
  }
  return [...keep];
}

// Current state of one permission bit in a channel's explicit overwrite for `id`: 'allow' | 'deny' | 'none'.
function overwriteState(channel, id, flagName) {
  const { PermissionsBitField } = require('discord.js');
  const flag = PermissionsBitField.Flags[flagName];
  const ow = channel.permissionOverwrites.cache.get(id);
  if (!ow) return 'none';
  if (ow.allow.has(flag)) return 'allow';
  if (ow.deny.has(flag)) return 'deny';
  return 'none';
}
const stateToValue = (s) => (s === 'allow' ? true : s === 'deny' ? false : null);

// Modlog post for actions whose subject is a channel, not a user.
async function sendChannelLog(guild, { action, channel, moderator, reason, color }) {
  const store = require('../database/store');
  const { base } = require('./embed');
  const channelId = store.getConfig(guild.id, 'modlog_channel');
  const log = channelId && guild.channels.cache.get(channelId);
  if (!log) return;
  const embed = base(guild.client, color)
    .setAuthor({ name: action.toUpperCase() })
    .setDescription([
      `**Channel** <#${channel.id}> \`${channel.id}\``,
      `**Moderator** ${moderator.tag} \`${moderator.id}\``,
      `**Reason** ${clip(reason || 'No reason provided', 1000)}`,
    ].join('\n'));
  await log.send({ embeds: [embed] }).catch(() => {});
}

module.exports = {
  REASON_MAX, clip, joinClipped, modLabel, reasonError, roleProblem, memberProblem,
  splitRoles, restorableRoles, overwriteState, stateToValue, sendChannelLog,
};
