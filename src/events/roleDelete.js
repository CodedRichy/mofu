const antinuke = require('../database/antinuke');
const { findAuditEntry, punishExecutor } = require('../utils/auditEntry');
const { response } = require('../utils/embed');
const { colors } = require('../utils/constants');
const log = require('../utils/logger');

module.exports = {
  name: 'roleDelete',
  async execute(role) {
    const { guild } = role;
    if (!antinuke.isEnabled(guild.id)) return;

    const entry = await findAuditEntry(guild, 32, role.id);
    if (!entry) return;
    if (entry.executor.id === guild.client.user.id) return;
    if (entry.executor.id === guild.ownerId) return;

    const executorId = entry.executor.id;

    if (antinuke.check(guild.id, executorId, 'role_delete')) {
      await punishExecutor(guild, executorId, '[sonder antinuke] Mass role delete detected');

      // Restore deleted role
      await guild.roles.create({
        name: role.name,
        color: role.color,
        permissions: role.permissions,
        position: role.position,
        reason: '[sonder antinuke] Restored deleted role',
      }).catch(() => {});

      const modlogChannel = require('../database/store').getConfig(guild.id, 'modlog_channel');
      if (modlogChannel) {
        const ch = guild.channels.cache.get(modlogChannel);
        if (ch) {
          ch.send({
            embeds: [response({
              client: guild.client,
              description: `**Antinuke triggered**\n**User** ${entry.executor.tag} \`${executorId}\`\n**Action** Mass role delete — user banned, role restored`,
              color: colors.error,
            })],
          }).catch(() => {});
        }
      }

      log.warn(`[antinuke] ${entry.executor.tag} triggered mass role delete in ${guild.name}`);
    }
  },
};
