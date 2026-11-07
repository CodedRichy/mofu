const snipe = require('../database/snipe');
const store = require('../database/store');
const { response } = require('../utils/embed');
const { colors } = require('../utils/constants');

module.exports = {
  name: 'messageDelete',
  execute(message) {
    if (!message.guild || message.author?.bot) return;
    if (!message.content && !message.attachments.size) return;
    // Messages the bot removed itself (antilink, word filter, AI automod) are never sniped.
    if (!require('../utils/automod').wasBotDeleted(message.id)) snipe.addDeleted(message.channel.id, message);

    const logCh = store.getConfig(message.guild.id, 'log_channel');
    if (!logCh || (store.getConfig(message.guild.id, 'log_message_delete') === false)) return;
    const ch = message.guild.channels.cache.get(logCh);
    if (!ch) return;

    const embed = response({ client: message.client, description: `**Message deleted in** ${message.channel}\n**Author** ${message.author.tag}\n\n${message.content?.slice(0, 1000) || '*No text*'}`, color: colors.error })
      .setFooter({ text: `ID: ${message.id}` })
      .setTimestamp();
    ch.send({ embeds: [embed] }).catch(() => {});
  },
};
