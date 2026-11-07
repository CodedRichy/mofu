const { EmbedBuilder } = require('discord.js');
const starboardDb = require('../database/starboard');
const store = require('../database/store');
const { colors } = require('../utils/constants');

module.exports = {
  name: 'messageReactionAdd',
  async execute(reaction, user) {
    if (!reaction.message.guild) return;
    // Reaction role panels: matched by message id + emoji, both present even on partial reactions.
    if (await require('../handlers/rolepanel').handleReaction(reaction, user, true).catch(() => false)) return;
    if (reaction.partial) await reaction.fetch().catch(() => null);
    if (!reaction.message.author) await reaction.message.fetch().catch(() => null);
    if (!reaction.message.author) return;

    const guildId = reaction.message.guild.id;
    const config = starboardDb.getConfig(guildId);
    if (!config.channel) return;
    if (reaction.emoji.name !== config.emoji && reaction.emoji.toString() !== config.emoji) return;
    if (!config.selfStar && reaction.message.author?.id === user.id) return;

    const count = reaction.count;
    if (count < config.threshold) return;

    const starChannel = reaction.message.guild.channels.cache.get(config.channel);
    if (!starChannel) return;
    if (reaction.message.channel.id === config.channel) return;

    const msg = reaction.message;
    const embed = new EmbedBuilder()
      .setColor(colors.primary)
      .setAuthor({ name: msg.author.tag, iconURL: msg.author.displayAvatarURL() })
      .setDescription(msg.content || '*No text*')
      .addFields({ name: 'Source', value: `[Jump to message](${msg.url})` })
      .setFooter({ text: `${config.emoji} ${count}` })
      .setTimestamp(msg.createdAt);

    const image = msg.attachments.find((a) => a.contentType?.startsWith('image/'));
    if (image) embed.setImage(image.url);

    const existing = starboardDb.getStarboardMessageId(guildId, msg.id);
    if (existing) {
      const starMsg = await starChannel.messages.fetch(existing).catch(() => null);
      if (starMsg) {
        await starMsg.edit({ content: `${config.emoji} **${count}** | ${msg.channel}`, embeds: [embed] }).catch(() => {});
        return;
      }
    }

    const sent = await starChannel.send({ content: `${config.emoji} **${count}** | ${msg.channel}`, embeds: [embed] }).catch(() => null);
    if (sent) starboardDb.setStarboardMessageId(guildId, msg.id, sent.id);
  },
};
