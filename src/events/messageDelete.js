const snipe = require('../database/snipe');
const logevents = require('../utils/logevents');
const { response, footer } = require('../utils/embed');
const { colors } = require('../utils/constants');

module.exports = {
  name: 'messageDelete',
  execute(message) {
    if (!message.guild || message.author?.bot) return;
    if (!message.content && !message.attachments.size) return;
    // Messages the bot removed itself (antilink, word filter, AI automod) are never sniped.
    if (!require('../utils/automod').wasBotDeleted(message.id)) snipe.addDeleted(message.channel.id, message);

    const ch = logevents.resolve(message.guild, 'log_message_delete');
    if (!ch) return;

    const embed = response({ client: message.client, description: `**Message deleted in** ${message.channel}\n**Author** ${message.author.tag}\n\n${message.content?.slice(0, 1000) || '*No text*'}`, color: colors.error })
      .setFooter(footer(message.client, `ID: ${message.id}`))
      .setTimestamp();
    ch.send({ embeds: [embed] }).catch(() => {});
  },
};
