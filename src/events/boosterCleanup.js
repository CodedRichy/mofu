const { Events } = require('discord.js');
const store = require('../database/store');
const log = require('../utils/logger');

// A custom booster role belongs to the boost. When someone stops boosting or leaves the server, delete the
// role and forget it, otherwise they keep the perk for free and the server fills with orphan roles.
async function removeBoosterRole(guild, userId, why) {
  const key = `boosterrole_${userId}`;
  const roleId = store.getConfig(guild.id, key);
  if (!roleId) return;
  store.setConfig(guild.id, key, null);
  const role = guild.roles.cache.get(roleId);
  if (!role) return;
  await role.delete(`Booster role removed: ${why}`).catch((err) => log.warn(`Could not delete booster role ${roleId}: ${err.message}`));
}

module.exports = [
  {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember) {
      // premiumSince is a date while boosting and null after. Partial old members have it undefined: skip those.
      if (oldMember.premiumSince && !newMember.premiumSince) await removeBoosterRole(newMember.guild, newMember.id, 'stopped boosting');
    },
  },
  {
    name: Events.GuildMemberRemove,
    async execute(member) {
      await removeBoosterRole(member.guild, member.id, 'left the server');
    },
  },
];
