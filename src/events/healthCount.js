// Counter listeners for the weekly health post. Separate listeners (the loader registers every export), so the
// existing event files are untouched. Everything is gated on the per-guild switch, which defaults OFF.
// Message text is read only to test whether it ends with a question mark in a help channel; it is never stored.
const { Events } = require('discord.js');
const stats = require('../database/healthstats');
const H = require('../utils/healthpost');

const on = (guildId) => !!guildId && stats.getConfig(guildId).enabled;

module.exports = [
  {
    name: Events.MessageCreate,
    async execute(message) {
      if (!message.guildId || message.author?.bot || message.webhookId || message.system) return;
      if (!on(message.guildId)) return;
      const cfg = stats.getConfig(message.guildId);
      const channelId = message.channel?.isThread?.() ? (message.channel.parentId || message.channelId) : message.channelId;

      stats.countMessage(message.guildId, channelId);
      stats.recordActivity(message.guildId, message.author.id);

      if (!cfg.helpChannels.includes(channelId)) return;
      // A reply to a tracked question from someone else answers it.
      const refId = message.reference?.messageId;
      if (refId) stats.markAnswered(message.guildId, refId, message.author.id);
      if (H.isQuestion(message.content)) stats.recordQuestion(message.guildId, channelId, message.id, message.author.id);
    },
  },
  {
    name: Events.GuildMemberAdd,
    async execute(member) {
      if (member.user?.bot || !on(member.guild.id)) return;
      stats.recordJoin(member.guild.id, member.id);
    },
  },
  {
    name: Events.GuildMemberRemove,
    async execute(member) {
      if (member.user?.bot || !on(member.guild.id)) return;
      stats.recordLeave(member.guild.id);
    },
  },
  {
    name: Events.MessageReactionAdd,
    async execute(reaction, user) {
      if (user?.bot) return;
      const guildId = reaction.message?.guildId;
      if (!on(guildId)) return;
      stats.recordActivity(guildId, user.id);
    },
  },
];
