const { PermissionFlagsBits } = require('discord.js');
const log = require('./logger');

const ROLE_PRESETS = {
  jailed: {
    name: 'Jailed',
    color: 0x2b2d31,
    permissions: [],
    hoist: false,
    mentionable: false,
  },
  moderator: {
    name: 'Moderator',
    color: 0x5e6ad2,
    permissions: [
      PermissionFlagsBits.KickMembers,
      PermissionFlagsBits.BanMembers,
      PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.ModerateMembers,
      PermissionFlagsBits.MuteMembers,
      PermissionFlagsBits.DeafenMembers,
      PermissionFlagsBits.MoveMembers,
      PermissionFlagsBits.ManageNicknames,
    ],
    hoist: true,
    mentionable: true,
  },
  member: {
    name: 'Member',
    color: 0x2b2d31,
    permissions: [],
    hoist: false,
    mentionable: false,
  },
};

async function createRole(guild, preset) {
  const config = typeof preset === 'string' ? ROLE_PRESETS[preset] : preset;
  if (!config) return null;

  const existing = guild.roles.cache.find((r) => r.name === config.name);
  if (existing) return existing;

  try {
    const role = await guild.roles.create({
      name: config.name,
      color: config.color || 0x2b2d31,
      permissions: config.permissions || [],
      hoist: config.hoist || false,
      mentionable: config.mentionable || false,
      reason: 'mofu role setup',
    });
    log.info(`Created role @${config.name} in ${guild.name}`);
    return role;
  } catch (err) {
    log.warn(`Failed to create @${config.name} in ${guild.name}: ${err.message}`);
    return null;
  }
}

async function lockdownRoleInChannels(guild, role, { deny = [], allow = [] } = {}) {
  let updated = 0;
  for (const channel of guild.channels.cache.values()) {
    if (!channel.permissionOverwrites) continue;
    try {
      await channel.permissionOverwrites.edit(role, {
        ...Object.fromEntries(deny.map((p) => [p, false])),
        ...Object.fromEntries(allow.map((p) => [p, true])),
      });
      updated++;
    } catch {
      // skip channels we can't edit
    }
  }
  return updated;
}

module.exports = { createRole, lockdownRoleInChannels, ROLE_PRESETS };
