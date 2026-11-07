const antinuke = require('../database/antinuke');
const { findAuditEntry, punishExecutor } = require('../utils/auditEntry');
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
      await punishExecutor(guild, executorId, '[sonder antinuke] Mass channel delete detected');

      // Restore deleted channel
      await guild.channels.create({
        name: channel.name,
        type: channel.type,
        parent: channel.parentId,
        position: channel.position,
        reason: '[sonder antinuke] Restored deleted channel',
      }).catch(() => {});

      const modlogChannel = require('../database/store').getConfig(guild.id, 'modlog_channel');
      if (modlogChannel) {
        const ch = guild.channels.cache.get(modlogChannel);
        if (ch) {
          ch.send({
            embeds: [response({
              client: guild.client,
              description: `**Antinuke triggered**\n**User** ${entry.executor.tag} \`${executorId}\`\n**Action** Mass channel delete — user banned, channel restored`,
              color: colors.error,
            })],
          }).catch(() => {});
        }
      }

      log.warn(`[antinuke] ${entry.executor.tag} triggered mass channel delete in ${guild.name}`);
    }
  },
};
