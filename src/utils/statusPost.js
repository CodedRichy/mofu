const { base } = require('./embed');
const { colors } = require('./constants');
const log = require('./logger');

// Posts online / offline / reconnect notices to the owner's status channel (STATUS_CHANNEL_ID).
// No channel configured = silent no-op. Only ever posts to the one configured channel.
async function post(client, title, description, color) {
  const id = process.env.STATUS_CHANNEL_ID;
  if (!id) return;
  try {
    const channel = await client.channels.fetch(id).catch(() => null);
    if (!channel?.isTextBased?.() || !channel.send) { log.warn('STATUS_CHANNEL_ID is set but that channel is not reachable'); return; }
    const embed = base(client, color).setAuthor({ name: title }).setTimestamp();
    if (description) embed.setDescription(description.slice(0, 1000));
    await channel.send({ embeds: [embed] });
  } catch (err) {
    log.warn(`status post failed: ${err.message}`);
  }
}

module.exports = {
  online: (client) => post(client, 'Sonder is online', `Serving ${client.guilds.cache.size} servers. Ping ${Math.round(client.ws.ping)}ms.`, colors.success),
  offline: (client, signal) => post(client, 'Sonder is going offline', `Shutting down (${signal}). Back shortly if this is a restart.`, colors.error),
  reconnected: (client) => post(client, 'Sonder reconnected', 'The connection to Discord dropped and has recovered.', colors.muted),
};
