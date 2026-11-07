const antinuke = require('../database/antinuke');
const { findAuditEntry, punishExecutor, stepLines } = require('../utils/auditEntry');
const { response } = require('../utils/embed');
const { colors } = require('../utils/constants');
const log = require('../utils/logger');

module.exports = {
  name: 'channelDelete',
  async execute(channel) {
    const { guild } = channel;
    if (!guild || !antinuke.isEnabled(guild.id)) return;

    const entry = await findAuditEntry(guild, 12, channel.id);
    if (!entry) return;
    if (entry.executor.id === guild.client.user.id) return;
    if (entry.executor.id === guild.ownerId) return;

    const executorId = entry.executor.id;

    if (antinuke.check(guild.id, executorId, 'channel_delete')) {
      const { banned, rolesStripped } = await punishExecutor(guild, executorId, '[sonder antinuke] Mass channel delete detected');

      // Restore deleted channel (name, type, category, position; not permissions or messages)
      const restored = await guild.channels.create({
        name: channel.name,
        type: channel.type,
        parent: channel.parentId,
        position: channel.position,
        reason: '[sonder antinuke] Restored deleted channel',
      }).then(() => true, () => false);

      const modlogChannel = require('../database/store').getConfig(guild.id, 'modlog_channel');
      if (modlogChannel) {
        const ch = guild.channels.cache.get(modlogChannel);
        if (ch) {
          ch.send({
            embeds: [response({
              client: guild.client,
              description: `**Antinuke triggered**\n**User** ${entry.executor.tag} \`${executorId}\`\n**Trigger** Mass channel delete\n${stepLines([['Ban', banned], ['Roles stripped', rolesStripped], ['Channel recreated (empty, no permission overwrites)', restored]])}`,
              color: colors.error,
            })],
          }).catch(() => {});
        }
      }

      log.warn(`[antinuke] ${entry.executor.tag} triggered mass channel delete in ${guild.name}`);
    }
  },
};
