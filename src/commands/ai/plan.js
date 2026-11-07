const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const handler = require('../../handlers/setupplan');

// "/plan set up tickets in #support and a welcome channel": the AI drafts a short list of steps from a fixed set,
// code checks every step, and nothing happens until the requester presses Apply.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('plan')
    .setDescription('Ask mofu to draft a server setup plan you approve before anything changes')
    .addStringOption((o) => o.setName('request').setDescription('What to set up, e.g. tickets in #support and a welcome channel (or: enable, disable)').setRequired(true).setMaxLength(400))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  cooldown: 5,

  async execute(interaction) {
    const request = (interaction.options.getString('request') || '').trim();
    const word = request.toLowerCase();
    if (word === 'enable' || word === 'on') return handler.setEnabled(interaction, true);
    if (word === 'disable' || word === 'off') return handler.setEnabled(interaction, false);
    return handler.propose(interaction, request);
  },
};
