const fs = require('fs');
const path = require('path');
const { base } = require('./embed');
const { colors } = require('./constants');
const log = require('./logger');

// One live status message in the owner's status channel (STATUS_CHANNEL_ID). It is edited in place (online,
// offline, reconnected) instead of posting a new line on every restart. If the stored message was deleted, a new
// one is posted. No channel configured = silent no-op. Only ever touches the one configured channel.
const STATE = path.join(__dirname, '../../data/status-message.json');

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf-8')); } catch { return {}; }
}

function writeState(s) {
  try {
    fs.mkdirSync(path.dirname(STATE), { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify(s), 'utf-8');
  } catch { /* losing the id only means one extra message next time */ }
}

async function post(client, title, description, color) {
  const id = process.env.STATUS_CHANNEL_ID;
  if (!id) return;
  try {
    const channel = await client.channels.fetch(id).catch(() => null);
    if (!channel?.isTextBased?.() || !channel.send) { log.warn('STATUS_CHANNEL_ID is set but that channel is not reachable'); return; }
    const embed = base(client, color).setAuthor({ name: title }).setTimestamp();
    if (description) embed.setDescription(description.slice(0, 1000));
    const payload = { embeds: [embed] };

    const saved = readState();
    if (saved.channelId === id && saved.messageId) {
      const msg = await channel.messages.fetch(saved.messageId).catch(() => null);
      if (msg && msg.editable) { await msg.edit(payload); return; }
    }
    const sent = await channel.send(payload);
    writeState({ channelId: id, messageId: sent.id });
  } catch (err) {
    log.warn(`status post failed: ${err.message}`);
  }
}

module.exports = {
  online: (client) => post(client, `${client.user?.username || 'Bot'} is online`, `Serving ${client.guilds.cache.size} servers. Ping ${Math.round(client.ws.ping)}ms.`, colors.success),
  offline: (client, signal) => post(client, `${client.user?.username || 'Bot'} is going offline`, `Shutting down (${signal}). Back shortly if this is a restart.`, colors.error),
  reconnected: (client) => post(client, `${client.user?.username || 'Bot'} reconnected`, 'The connection to Discord dropped and has recovered.', colors.muted),
};
