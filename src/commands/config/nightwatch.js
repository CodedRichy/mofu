const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const store = require('../../database/store');
const { createConfigChannel, CHANNEL_DEFAULTS } = require('../../utils/channelCreate');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nightwatch')
    .setDescription('Enhanced monitoring during off-hours')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName('enable')
        .setDescription('Enable night watch')
        .addIntegerOption((o) => o.setName('start').setDescription('Start hour (24h format, e.g. 23 for 11pm)').setRequired(true).setMinValue(0).setMaxValue(23))
        .addIntegerOption((o) => o.setName('end').setDescription('End hour (24h format, e.g. 7 for 7am)').setRequired(true).setMinValue(0).setMaxValue(23))
        .addChannelOption((o) => o.setName('alert_channel').setDescription('Channel for alerts').setRequired(true).addChannelTypes(ChannelType.GuildText))
    )
    .addSubcommand((s) => s.setName('disable').setDescription('Disable night watch'))
    .addSubcommand((s) => s.setName('status').setDescription('View night watch config'))
    .addSubcommand((s) => s.setName('create').setDescription('Create a #nightwatch-alerts channel and set it up')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'enable') {
      const start = interaction.options.getInteger('start');
      const end = interaction.options.getInteger('end');
      const alertChannel = interaction.options.getChannel('alert_channel');

      store.setConfig(guildId, 'nightwatch', {
        enabled: true,
        start,
        end,
        alertChannel: alertChannel.id,
      });

      return interaction.reply({
        embeds: [response({
          client: interaction.client,
          description: `Night watch enabled.\n**Active** ${start}:00 → ${end}:00 (bot host time)\n**Alerts** ${alertChannel}\n\nDuring these hours, messages from accounts under a week old and messages with links are posted to ${alertChannel}.`,
          color: colors.success,
        })],
      });
    }

    if (sub === 'disable') {
      store.setConfig(guildId, 'nightwatch', null);
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Night watch disabled.', color: colors.muted })] });
    }

    if (sub === 'status') {
      const config = store.getConfig(guildId, 'nightwatch');
      if (!config?.enabled) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Night watch is **not configured**.', color: colors.muted })], ephemeral: true });
      }

      const now = new Date();
      const currentHour = now.getHours();
      const isActive = config.start > config.end
        ? currentHour >= config.start || currentHour < config.end
        : currentHour >= config.start && currentHour < config.end;

      const desc = [
        `**Status** ${isActive ? '🔴 Active now' : '🟢 Inactive'}`,
        `**Hours** ${config.start}:00 → ${config.end}:00 (bot host time)`,
        `**Alerts** <#${config.alertChannel}>`,
      ].join('\n');

      return interaction.reply({ embeds: [response({ client: interaction.client, description: desc, color: isActive ? colors.error : colors.success })] });
    }

    if (sub === 'create') {
      const defaults = CHANNEL_DEFAULTS.nightwatch_channel;
      const ch = await createConfigChannel(interaction.guild, { ...defaults, client: interaction.client });
      if (!ch) return interaction.reply({ embeds: [response({ client: interaction.client, description: "Couldn't create channel. Make sure I have **Manage Channels** permission.", color: colors.error })], ephemeral: true });
      store.setConfig(guildId, 'nightwatch', { enabled: true, start: 23, end: 7, alertChannel: ch.id });
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `Created ${ch} and set as nightwatch alert channel.\n**Active** 23:00 → 7:00 (default hours, bot host time)`, color: colors.success })] });
    }
  },
};
