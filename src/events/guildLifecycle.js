const { Events } = require('discord.js');
const retention = require('../database/retention');
const log = require('../utils/logger');

// Starts / cancels the 30-day data-retention clock described in the privacy policy.
module.exports = [
  {
    name: Events.GuildDelete,
    execute(guild) {
      if (!guild.available) return; // an outage, not a removal
      retention.markLeft(guild.id);
      log.info(`Removed from ${guild.name || guild.id}; data scheduled for deletion in ${retention.RETENTION_DAYS} days`);
    },
  },
  {
    name: Events.GuildCreate,
    execute(guild) {
      retention.markReturned(guild.id);
    },
  },
];
