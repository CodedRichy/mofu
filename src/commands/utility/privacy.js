const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');

// Three lines, plain words. Keep in step with src/database/privacy.js and src/database/retention.js.
const LINES = [
  '**What I store:** per server, your XP, economy balance and inventory, reminders, AFK/timezone/Last.fm settings, and short-lived snapshots of deleted or edited messages for `/snipe`.',
  '**What stays:** moderation records about you (warnings, mod notes, cases, AI action logs) are kept for the server\'s safety; the chat text behind AI actions is cleared after 30 days.',
  '**Your controls:** `/forgetme` deletes your personal data (this server or everywhere). When a server removes Sonder, everything for that server is deleted 30 days later.',
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('privacy')
    .setDescription('What Sonder stores about you and how to delete it'),

  LINES,

  async execute(interaction) {
    await interaction.reply({
      embeds: [response({ client: interaction.client, description: LINES.join('\n\n'), color: colors.info })],
      ephemeral: true,
    });
  },
};
