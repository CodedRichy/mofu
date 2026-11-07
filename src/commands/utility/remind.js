const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const { parse } = require('../../utils/duration');
const reminders = require('../../database/reminders');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Set, view, or cancel reminders')
    .addSubcommand((s) =>
      s.setName('set')
        .setDescription('Set a reminder')
        .addStringOption((o) => o.setName('time').setDescription('Duration (e.g. 30m, 1h, 1d)').setRequired(true))
        .addStringOption((o) => o.setName('message').setDescription('What to remind you about').setRequired(true).setMaxLength(1000))
    )
    .addSubcommand((s) => s.setName('list').setDescription('View active reminders'))
    .addSubcommand((s) =>
      s.setName('cancel')
        .setDescription('Cancel a reminder')
        .addIntegerOption((o) => o.setName('id').setDescription('Reminder ID').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const timeStr = interaction.options.getString('time');
      const message = interaction.options.getString('message');
      const duration = parse(timeStr);

      const MIN_MS = 10000;
      const MAX_MS = 7 * 24 * 60 * 60 * 1000;
      if (!duration || duration < MIN_MS) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: !duration ? 'Invalid duration. Use formats like `30m`, `1h`, `1d`.' : `Minimum reminder duration is ${MIN_MS / 1000} seconds`, color: colors.error })], ephemeral: true });
      }

      if (duration > MAX_MS) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `Reminders can be at most **${MAX_MS / 86400000} days**.`, color: colors.error })], ephemeral: true });
      }

      const { id, expiresAt } = reminders.add(interaction.user.id, interaction.channel.id, message, duration, interaction.guild?.id || '');

      reminders.setCallback(id, () => {
        const ch = interaction.client.channels.cache.get(interaction.channel.id);
        if (ch) {
          ch.send({
            content: `<@${interaction.user.id}>`,
            embeds: [response({ client: interaction.client, description: `**Reminder:** ${message}`, color: colors.primary })],
          }).catch(() => {});
        }
      });

      const timestamp = Math.floor(expiresAt / 1000);
      await interaction.reply({
        embeds: [response({ client: interaction.client, description: `Reminder set for <t:${timestamp}:R> — ${message}`, color: colors.success })],
      });
    } else if (sub === 'list') {
      const list = reminders.list(interaction.user.id);
      if (!list.length) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'No active reminders.', color: colors.muted })], ephemeral: true });
      }

      const desc = list.map((r) => `\`#${r.id}\` <t:${Math.floor(r.expiresAt / 1000)}:R> — ${r.message}`).join('\n');
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `**Your Reminders**\n\n${desc}`, color: colors.primary })], ephemeral: true });
    } else if (sub === 'cancel') {
      const id = interaction.options.getInteger('id');
      const removed = reminders.remove(id, interaction.user.id);
      if (!removed) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Reminder not found or not yours.', color: colors.error })], ephemeral: true });
      }
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `Reminder **#${id}** cancelled.`, color: colors.success })], ephemeral: true });
    }
  },
};
