const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const { RETENTION_DAYS } = require('../../database/retention');
const { KEEP: BACKUP_COPIES } = require('../../utils/backup');
const SNIPE_HOURS = require('../../database/snipe').MAX_AGE_MS / 3600000;

// Three lines, plain words. Keep in step with src/database/privacy.js (what /forgetme deletes),
// src/database/retention.js and src/utils/backup.js. Only list what the code really stores and deletes.
const LINES = [
  `**What I store:** per server, your XP and level, economy balance, inventory and cooldowns, reminders, birthday, invite count and who invited you, AFK/timezone/Last.fm settings, quotes of you that members saved, and (only where the server turned snipe on) snapshots of your deleted or edited messages and removed reactions for \`/snipe\`, kept ${SNIPE_HOURS} hours. Also giveaway entries, your booster role and temp voice channels you own.`,
  `**What stays:** moderation records about you (warnings, mod notes, cases, AI action logs) are kept for the server's safety; the chat text behind AI actions is cleared after ${RETENTION_DAYS} days. \`/forgetme\` also leaves giveaway entries, booster role and voice channel ownership, and quotes you saved of other people.`,
  `**Your controls:** \`/forgetme\` deletes the rest of your personal data (this server or everywhere). When a server removes mofu, everything for that server is deleted ${RETENTION_DAYS} days later. Deleted data can stay in the daily database backups until they rotate out (the newest ${BACKUP_COPIES} are kept, so about ${BACKUP_COPIES} more days).`,
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('privacy')
    .setDescription('What mofu stores about you and how to delete it'),

  LINES,

  async execute(interaction) {
    await interaction.reply({
      embeds: [response({ client: interaction.client, description: LINES.join('\n\n'), color: colors.info })],
      ephemeral: true,
    });
  },
};
