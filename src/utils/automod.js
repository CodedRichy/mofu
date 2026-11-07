// Content automod shared by messageCreate and messageUpdate: antilink + word filter.
const store = require('../database/store');
const { response } = require('./embed');
const { colors } = require('./constants');
const { hasBlockedLink } = require('./linkfilter');

// ids of messages the bot deleted itself; snipe must not resurrect them
const botDeleted = new Map();
function markBotDeleted(id) {
  botDeleted.set(id, Date.now());
  if (botDeleted.size > 500) {
    const cutoff = Date.now() - 60000;
    for (const [k, t] of botDeleted) if (t < cutoff) botDeleted.delete(k);
  }
}
function wasBotDeleted(id) { return botDeleted.has(id); }

// Returns { type, notice } or null.
function checkContent(guildId, content) {
  if (!content) return null;
  if (store.getConfig(guildId, 'antilink')) {
    const whitelist = store.getConfig(guildId, 'antilink_whitelist') || [];
    if (hasBlockedLink(content, whitelist)) return { type: 'antilink', notice: 'links are not allowed here.' };
  }
  const wordFilter = store.getConfig(guildId, 'word_filter');
  if (wordFilter?.length) {
    const lower = content.toLowerCase();
    if (wordFilter.find((w) => lower.includes(String(w).toLowerCase()))) return { type: 'wordfilter', notice: 'that word is not allowed here.' };
  }
  return null;
}

// Run the checks on a message and delete it on a hit. Returns true when it was removed.
function enforce(message, content = message.content) {
  const member = message.member;
  if (!member || member.permissions.has('ManageMessages')) return false;
  const hit = checkContent(message.guild.id, content);
  if (!hit) return false;
  markBotDeleted(message.id);
  message.delete().catch(() => {});
  message.channel.send({ embeds: [response({ client: message.client, description: `${message.author}, ${hit.notice}`, color: colors.error })], allowedMentions: { parse: [] } })
    .then((m) => setTimeout(() => m.delete().catch(() => {}), 5000)).catch(() => {});
  return true;
}

module.exports = { checkContent, enforce, markBotDeleted, wasBotDeleted };
