/**
 * Return every member of the guild, hitting the gateway only when the cache
 * is incomplete. With the GuildMembers intent, discord.js keeps the member
 * cache current via add/update/remove events, so once a full fetch has run
 * the cache is authoritative and repeat calls cost nothing.
 *
 * Same return type as guild.members.fetch(): a Collection<id, GuildMember>.
 */
async function fetchAllMembers(guild) {
  if (guild.members.cache.size >= guild.memberCount) return guild.members.cache;
  return guild.members.fetch();
}

module.exports = { fetchAllMembers };
