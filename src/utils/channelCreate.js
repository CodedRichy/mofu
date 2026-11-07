const { ChannelType, PermissionFlagsBits } = require('discord.js');
const log = require('./logger');
const { LOG_CHANNEL, channelNames } = require('./constants');

async function createConfigChannel(guild, { name, isPrivate = true, client }) {
  const names = channelNames(name);
  const existing = guild.channels.cache.find(
    (c) => names.includes(c.name) && c.type === ChannelType.GuildText
  );
  if (existing) return existing;

  const permissionOverwrites = isPrivate
    ? [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      ]
    : [];

  try {
    const ch = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      permissionOverwrites,
    });
    log.info(`Created channel #${name} in ${guild.name}`);
    return ch;
  } catch (err) {
    log.warn(`Failed to create #${name} in ${guild.name}: ${err.message}`);
    return null;
  }
}

const CHANNEL_DEFAULTS = {
  welcome_channel: { name: 'welcome', isPrivate: false },
  goodbye_channel: { name: 'goodbye', isPrivate: false },
  log_channel: { name: LOG_CHANNEL, isPrivate: true },
  modlog_channel: { name: 'modlog', isPrivate: true },
  audit_log_channel: { name: 'audit-log', isPrivate: true },
  starboard_channel: { name: 'starboard', isPrivate: false },
  counter_channel: { name: 'counting', isPrivate: false },
  confession_channel: { name: 'confessions', isPrivate: false },
  bump_channel: { name: 'bump', isPrivate: false },
  ticket_logs: { name: 'ticket-logs', isPrivate: true },
  levelup_channel: { name: 'level-ups', isPrivate: false },
  birthday_channel: { name: 'birthday-announcements', isPrivate: false },
  nightwatch_channel: { name: 'nightwatch-alerts', isPrivate: true },
};

module.exports = { createConfigChannel, CHANNEL_DEFAULTS };
