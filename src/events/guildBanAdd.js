const antinuke = require('../database/antinuke');
const { findAuditEntry, punishExecutor, stepLines } = require('../utils/auditEntry');
const { response } = require('../utils/embed');
const { colors } = require('../utils/constants');
const log = require('../utils/logger');

module.exports = {
  name: 'guildBanAdd',
  async execute(ban) {
    const { guild } = ban;
    if (!antinuke.isEnabled(guild.id)) return;

    const entry = await findAuditEntry(guild, 22, ban.user.id);
    if (!entry) return;
    if (entry.executor.bot && entry.executor.id === guild.client.user.id) return;

    const executorId = entry.executor.id;
    if (executorId === guild.ownerId) return;

    if (antinuke.check(guild.id, executorId, 'ban')) {
      const { banned, rolesStripped } = await punishExecutor(guild, executorId, '[mofu antinuke] Mass ban detected');

      const unbanned = await guild.members.unban(ban.user.id, '[mofu antinuke] Reversed mass ban').then(() => true, () => false);

      const modlogChannel = require('../database/store').getConfig(guild.id, 'modlog_channel');
      if (modlogChannel) {
        const ch = guild.channels.cache.get(modlogChannel);
        if (ch) {
          ch.send({
            embeds: [response({
              client: guild.client,
              description: `**Antinuke triggered**\n**User** ${entry.executor.tag} \`${executorId}\`\n**Trigger** Mass ban\n${stepLines([['Ban', banned], ['Roles stripped', rolesStripped], [`Unbanned ${ban.user.tag}`, unbanned]])}`,
              color: colors.error,
            })],
          }).catch(() => {});
        }
      }

      log.warn(`[antinuke] ${entry.executor.tag} triggered mass ban in ${guild.name}`);
    }
  },
};
