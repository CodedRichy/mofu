const snipe = require('../database/snipe');

module.exports = {
  name: 'messageReactionRemove',
  async execute(reaction, user) {
    if (!reaction.message.guild || user.bot) return;
    if (await require('../handlers/rolepanel').handleReaction(reaction, user, false).catch(() => false)) return;
    if (reaction.partial) await reaction.fetch().catch(() => {});
    snipe.addReaction(reaction.message.channel.id, reaction, user);
  },
};
