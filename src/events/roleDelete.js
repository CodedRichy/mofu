const antinuke = require('../database/antinuke');
const { findAuditEntry, punishExecutor, stepLines } = require('../utils/auditEntry');
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
      const { banned, rolesStripped } = await punishExecutor(guild, executorId, '[sonder antinuke] Mass role delete detected');

      // Restore deleted role (name, color, permissions, position; members are not re-added)
      const restored = await guild.roles.create({
        name: role.name,
        color: role.color,
        permissions: role.permissions,
        position: role.position,
        reason: '[sonder antinuke] Restored deleted role',
      }).then(() => true, () => false);

      const modlogChannel = require('../database/store').getConfig(guild.id, 'modlog_channel');
      if (modlogChannel) {
        const ch = guild.channels.cache.get(modlogChannel);
        if (ch) {
          ch.send({
            embeds: [response({
              client: guild.client,
              description: `**Antinuke triggered**\n**User** ${entry.executor.tag} \`${executorId}\`\n**Trigger** Mass role delete\n${stepLines([['Ban', banned], ['Roles stripped', rolesStripped], ['Role recreated (no members re-added)', restored]])}`,
              color: colors.error,
            })],
          }).catch(() => {});
        }
      }

      log.warn(`[antinuke] ${entry.executor.tag} triggered mass role delete in ${guild.name}`);
    }
  },
};
