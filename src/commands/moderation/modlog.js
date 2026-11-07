const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const store = require('../../database/store');
const { createConfigChannel, CHANNEL_DEFAULTS } = require('../../utils/channelCreate');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('modlog')
    .setDescription('Configure the moderation log channel')
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Set the mod log channel')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Channel for mod logs').setRequired(true).addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand((sub) => sub.setName('create').setDescription('Create a private #modlog channel'))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove the mod log channel'))
    .addSubcommand((sub) => sub.setName('view').setDescription('View current mod log channel'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      const defaults = CHANNEL_DEFAULTS.modlog_channel;
      const ch = await createConfigChannel(interaction.guild, { ...defaults, client: interaction.client });

      if (!ch) {
        return interaction.reply({
          embeds: [response({ client: interaction.client, description: "Couldn't create channel. Make sure I have **Manage Channels** permission.", color: colors.error })],
          ephemeral: true,
        });
      }

      store.setConfig(interaction.guild.id, 'modlog_channel', ch.id);

      await interaction.reply({
        embeds: [response({ client: interaction.client, description: `Created ${ch} (private) and set as modlog channel. Member appeals are posted there too.`, color: colors.success })],
      });
    } else if (sub === 'set') {
      const channel = interaction.options.getChannel('channel');
      store.setConfig(interaction.guild.id, 'modlog_channel', channel.id);

      await interaction.reply({
        embeds: [response({ client: interaction.client, description: `Mod log channel set to ${channel}. Member appeals are posted there too.`, color: colors.success })],
      });
    } else if (sub === 'remove') {
      store.setConfig(interaction.guild.id, 'modlog_channel', null);

      await interaction.reply({
        embeds: [response({ client: interaction.client, description: 'Mod log channel removed.', color: colors.muted })],
      });
    } else {
      const channelId = store.getConfig(interaction.guild.id, 'modlog_channel');

      await interaction.reply({
        embeds: [response({
          client: interaction.client,
          description: channelId ? `Mod log channel: <#${channelId}>` : 'No mod log channel configured.\nUse `/modlog set` to configure.',
          color: colors.info,
        })],
      });
    }
  },
};
