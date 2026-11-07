const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { colors, LOG_CHANNEL } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const store = require('../../database/store');
const logevents = require('../../utils/logevents');
const { createConfigChannel, CHANNEL_DEFAULTS } = require('../../utils/channelCreate');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logging')
    .setDescription('Configure server logging')
    .addSubcommand((sub) =>
      sub.setName('channel').setDescription('Set the logging channel')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel for logs').setRequired(true).addChannelTypes(ChannelType.GuildText))
    )
    .addSubcommand((sub) =>
      sub.setName('toggle').setDescription('Toggle a log type')
        .addStringOption((o) =>
          o.setName('type').setDescription('Log type').setRequired(true)
            .addChoices(...logevents.EVENTS.map((e) => ({ name: e.label, value: e.key })))
        )
        .addBooleanOption((o) => o.setName('enabled').setDescription('Enable or disable').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('create').setDescription(`Create a private #${LOG_CHANNEL} channel`))
    .addSubcommand((sub) => sub.setName('disable').setDescription('Disable all logging'))
    .addSubcommand((sub) => sub.setName('settings').setDescription('View logging settings'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild } = interaction;

    if (sub === 'create') {
      const defaults = CHANNEL_DEFAULTS.log_channel;
      const ch = await createConfigChannel(guild, { ...defaults, client: interaction.client });
      if (!ch) return interaction.reply({ embeds: [response({ client: interaction.client, description: "Couldn't create channel. Make sure I have **Manage Channels** permission.", color: colors.error })], ephemeral: true });
      store.setConfig(guild.id, 'log_channel', ch.id);
      await interaction.reply({ embeds: [response({ client: interaction.client, description: `Created ${ch} (private) and set as log channel.`, color: colors.success })] });

    } else if (sub === 'channel') {
      const channel = interaction.options.getChannel('channel');
      const existing = store.getConfig(guild.id, 'log_channel');
      if (existing === channel.id) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `Log channel is already set to ${channel}`, color: colors.warning })], ephemeral: true });
      }
      store.setConfig(guild.id, 'log_channel', channel.id);
      const msg = existing ? `Log channel updated to ${channel} (was <#${existing}>)` : `Log channel set to ${channel}`;
      await interaction.reply({ embeds: [response({ client: interaction.client, description: msg, color: colors.success })] });

    } else if (sub === 'toggle') {
      const type = interaction.options.getString('type');
      const enabled = interaction.options.getBoolean('enabled');
      if (!logevents.KEYS.includes(type)) return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Unknown log type.', color: colors.error })], ephemeral: true });
      const label = logevents.label(type);
      const current = logevents.isEnabled(guild.id, type);
      if (current === enabled) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `**${label}** logging is already ${enabled ? 'enabled' : 'disabled'}`, color: colors.warning })], ephemeral: true });
      }
      store.setConfig(guild.id, type, enabled);
      await interaction.reply({ embeds: [response({ client: interaction.client, description: `**${label}** logging ${enabled ? 'enabled' : 'disabled'}`, color: colors.success })] });

    } else if (sub === 'disable') {
      const existing = logevents.channelId(guild.id);
      if (!existing) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Logging is not configured', color: colors.warning })], ephemeral: true });
      }
      store.setConfig(guild.id, 'log_channel', null);
      store.setConfig(guild.id, 'logging_channel', null);
      await interaction.reply({ embeds: [response({ client: interaction.client, description: 'Logging disabled.', color: colors.muted })] });

    } else {
      const ch = logevents.channelId(guild.id);
      const lines = logevents.stateLines(guild.id);

      await interaction.reply({
        embeds: [response({
          client: interaction.client,
          description: `**Channel** ${ch ? `<#${ch}>` : 'Not set'}\n\n${lines.join('\n')}\n\nNot logged to this channel: ${logevents.NOT_LOGGED}.`,
          color: colors.info,
        })],
      });
    }
  },
};
