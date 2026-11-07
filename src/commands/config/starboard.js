const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const store = require('../../database/store');
const starboardDb = require('../../database/starboard');
const { createConfigChannel, CHANNEL_DEFAULTS } = require('../../utils/channelCreate');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('starboard')
    .setDescription('Configure the starboard')
    .addSubcommand((sub) =>
      sub.setName('channel').setDescription('Set the starboard channel')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel for starred messages').setRequired(true).addChannelTypes(ChannelType.GuildText))
    )
    .addSubcommand((sub) =>
      sub.setName('threshold').setDescription('Set minimum stars to post')
        .addIntegerOption((o) => o.setName('count').setDescription('Minimum star count (default: 3)').setRequired(true).setMinValue(1).setMaxValue(25))
    )
    .addSubcommand((sub) =>
      sub.setName('emoji').setDescription('Set the starboard emoji')
        .addStringOption((o) => o.setName('emoji').setDescription('Emoji to use (default: ⭐)').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('selfstar').setDescription('Toggle self-starring')
        .addBooleanOption((o) => o.setName('allow').setDescription('Allow self-starring').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('create').setDescription('Create a #starboard channel'))
    .addSubcommand((sub) => sub.setName('disable').setDescription('Disable starboard'))
    .addSubcommand((sub) => sub.setName('settings').setDescription('View starboard settings'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild } = interaction;

    if (sub === 'create') {
      const defaults = CHANNEL_DEFAULTS.starboard_channel;
      const ch = await createConfigChannel(guild, { name: defaults.name, isPrivate: defaults.isPrivate, client: interaction.client });
      if (!ch) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Failed to create channel. Make sure I have the **Manage Channels** permission.', color: colors.error })], ephemeral: true });
      }
      store.setConfig(guild.id, 'starboard_channel', ch.id);
      if (!store.getConfig(guild.id, 'starboard_threshold')) store.setConfig(guild.id, 'starboard_threshold', 3);
      if (!store.getConfig(guild.id, 'starboard_emoji')) store.setConfig(guild.id, 'starboard_emoji', '⭐');
      const threshold = store.getConfig(guild.id, 'starboard_threshold');
      const emoji = store.getConfig(guild.id, 'starboard_emoji');
      await interaction.reply({ embeds: [response({ client: interaction.client, description: `Created ${ch} and set as starboard channel (threshold: ${threshold} ${emoji})`, color: colors.success })] });

    } else if (sub === 'channel') {
      const channel = interaction.options.getChannel('channel');
      const existing = store.getConfig(guild.id, 'starboard_channel');
      if (existing === channel.id) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `Starboard channel is already set to ${channel}`, color: colors.warning })], ephemeral: true });
      }
      store.setConfig(guild.id, 'starboard_channel', channel.id);
      const msg = existing ? `Starboard channel updated to ${channel} (was <#${existing}>)` : `Starboard channel set to ${channel}`;
      await interaction.reply({ embeds: [response({ client: interaction.client, description: msg, color: colors.success })] });

    } else if (sub === 'threshold') {
      const count = interaction.options.getInteger('count');
      const existingThreshold = store.getConfig(guild.id, 'starboard_threshold');
      if (existingThreshold === count) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `Starboard threshold is already set to **${count}** stars`, color: colors.warning })], ephemeral: true });
      }
      store.setConfig(guild.id, 'starboard_threshold', count);
      const msg = existingThreshold != null ? `Starboard threshold updated to **${count}** stars (was **${existingThreshold}**)` : `Starboard threshold set to **${count}** stars`;
      await interaction.reply({ embeds: [response({ client: interaction.client, description: msg, color: colors.success })] });

    } else if (sub === 'emoji') {
      const emoji = interaction.options.getString('emoji');
      const existingEmoji = store.getConfig(guild.id, 'starboard_emoji');
      if (existingEmoji === emoji) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `Starboard emoji is already set to ${emoji}`, color: colors.warning })], ephemeral: true });
      }
      store.setConfig(guild.id, 'starboard_emoji', emoji);
      const msg = existingEmoji ? `Starboard emoji updated to ${emoji} (was ${existingEmoji})` : `Starboard emoji set to ${emoji}`;
      await interaction.reply({ embeds: [response({ client: interaction.client, description: msg, color: colors.success })] });

    } else if (sub === 'selfstar') {
      const allow = interaction.options.getBoolean('allow');
      const existingSelfstar = store.getConfig(guild.id, 'starboard_selfstar');
      if (existingSelfstar === allow) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `Self-starring is already **${allow ? 'enabled' : 'disabled'}**`, color: colors.warning })], ephemeral: true });
      }
      store.setConfig(guild.id, 'starboard_selfstar', allow);
      await interaction.reply({ embeds: [response({ client: interaction.client, description: `Self-starring **${allow ? 'enabled' : 'disabled'}**`, color: colors.success })] });

    } else if (sub === 'disable') {
      const existing = store.getConfig(guild.id, 'starboard_channel');
      if (!existing) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Starboard is not configured', color: colors.warning })], ephemeral: true });
      }
      store.setConfig(guild.id, 'starboard_channel', null);
      await interaction.reply({ embeds: [response({ client: interaction.client, description: 'Starboard disabled.', color: colors.muted })] });

    } else {
      const config = starboardDb.getConfig(guild.id);
      await interaction.reply({
        embeds: [response({
          client: interaction.client,
          description: `**Channel** ${config.channel ? `<#${config.channel}>` : 'Not set'}\n**Threshold** ${config.threshold}\n**Emoji** ${config.emoji}\n**Self-star** ${config.selfStar ? 'Allowed' : 'Disabled'}`,
          color: colors.info,
        })],
      });
    }
  },
};
