const snipe = require('../database/snipe');
const store = require('../database/store');
const automod = require('../utils/automod');
const { response } = require('../utils/embed');
const { colors } = require('../utils/constants');

module.exports = {
  name: 'messageUpdate',
  async execute(oldMessage, newMessage) {
    if (!oldMessage.guild || oldMessage.author?.bot || newMessage.author?.bot) return;

    // Partial edits (message was not cached): fetch so the edited text can be checked.
    if (newMessage.partial) {
      try { newMessage = await newMessage.fetch(); } catch { return; }
    }
    if (newMessage.author?.bot) return;
    if (oldMessage.content === newMessage.content) return;

    // Automod on the edited text (same rules and staff exemption as new messages).
    if (newMessage.member && automod.enforce(newMessage, newMessage.content)) return;

    if (oldMessage.author) snipe.addEdited(oldMessage.channel.id, oldMessage, newMessage);

    const logCh = store.getConfig(oldMessage.guild.id, 'log_channel');
    if (!logCh || (store.getConfig(oldMessage.guild.id, 'log_message_edit') === false)) return;
    const ch = oldMessage.guild.channels.cache.get(logCh);
    if (!ch) return;

    const embed = response({ client: oldMessage.client, description: `**Message edited in** ${oldMessage.channel} [Jump](${newMessage.url})\n**Author** ${oldMessage.author?.tag || newMessage.author?.tag || 'unknown'}\n\n**Before**\n${oldMessage.content?.slice(0, 500) || '*empty*'}\n\n**After**\n${newMessage.content?.slice(0, 500) || '*empty*'}`, color: colors.warning })
      .setFooter({ text: `ID: ${oldMessage.id}` })
      .setTimestamp();
    ch.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
  },
};
