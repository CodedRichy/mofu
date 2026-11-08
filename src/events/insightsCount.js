// Aggregate counters for the dashboard Insights tab: messages, joins and leaves per server per UTC day.
// A number goes up by one; nothing about the message, the author or the channel is read or kept.
// Separate listeners (the loader registers every export), so the existing event files are untouched.
const { Events } = require('discord.js');
const insights = require('../database/insights');

module.exports = [
  {
    name: Events.MessageCreate,
    async execute(message) {
      if (!message.guildId || message.author?.bot || message.webhookId || message.system) return;
      insights.countMessage(message.guildId);
    },
  },
  {
    name: Events.GuildMemberAdd,
    async execute(member) {
      if (member.user?.bot) return;
      insights.countJoin(member.guild.id);
    },
  },
  {
    name: Events.GuildMemberRemove,
    async execute(member) {
      if (member.user?.bot) return;
      insights.countLeave(member.guild.id);
    },
  },
];
