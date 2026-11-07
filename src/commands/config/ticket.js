const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response, base } = require('../../utils/embed');
const store = require('../../database/store');
const { createConfigChannel, CHANNEL_DEFAULTS } = require('../../utils/channelCreate');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Configure the ticket system')
    .addSubcommand((sub) =>
      sub.setName('setup').setDescription('Set up the ticket panel')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel to post the ticket panel').setRequired(true).addChannelTypes(ChannelType.GuildText))
        .addRoleOption((o) => o.setName('support').setDescription('Support team role').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('category').setDescription('Set ticket category')
        .addChannelOption((o) => o.setName('category').setDescription('Category for ticket channels').setRequired(true).addChannelTypes(ChannelType.GuildCategory))
    )
    .addSubcommand((sub) =>
      sub.setName('logs').setDescription('Set ticket log channel')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel for ticket transcripts').setRequired(true).addChannelTypes(ChannelType.GuildText))
    )
    .addSubcommand((sub) => sub.setName('create').setDescription('Create a #ticket-logs channel and enable tickets'))
    .addSubcommand((sub) => sub.setName('disable').setDescription('Disable the ticket system'))
    .addSubcommand((sub) => sub.setName('settings').setDescription('View ticket settings'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild } = interaction;

    if (sub === 'create') {
      const ch = await createConfigChannel(guild, { ...CHANNEL_DEFAULTS.ticket_logs, client: interaction.client });
      if (!ch) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Failed to create the ticket-logs channel. Check my permissions.', color: colors.error })], ephemeral: true });
      }
      store.setConfig(guild.id, 'ticket_logs', ch.id);
      store.setConfig(guild.id, 'ticket_enabled', true);
      await interaction.reply({ embeds: [response({ client: interaction.client, description: `Created ${ch} (private) and enabled ticket system.`, color: colors.success })] });

    } else if (sub === 'setup') {
      const channel = interaction.options.getChannel('channel');
      const supportRole = interaction.options.getRole('support');

      store.setConfig(guild.id, 'ticket_enabled', true);
      store.setConfig(guild.id, 'ticket_support_role', supportRole.id);

      const embed = base(interaction.client, colors.primary)
        .setAuthor({ name: 'Support Tickets', iconURL: guild.iconURL() })
        .setDescription('Need help? Click the button below to open a ticket.\nIt opens a private channel that support staff can see.');

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_open')
          .setLabel('Open Ticket')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🎫'),
      );

      try {
        await channel.send({ embeds: [embed], components: [row] });
      } catch {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `Failed to send the ticket panel to ${channel}. Check my permissions in that channel.`, color: colors.error })], ephemeral: true });
      }
      await interaction.reply({ embeds: [response({ client: interaction.client, description: `Ticket panel created in ${channel}\nSupport role: ${supportRole}`, color: colors.success })], ephemeral: true });

    } else if (sub === 'category') {
      const category = interaction.options.getChannel('category');
      store.setConfig(guild.id, 'ticket_category', category.id);
      await interaction.reply({ embeds: [response({ client: interaction.client, description: `Ticket category set to **${category.name}**`, color: colors.success })] });

    } else if (sub === 'logs') {
      const channel = interaction.options.getChannel('channel');
      store.setConfig(guild.id, 'ticket_logs', channel.id);
      await interaction.reply({ embeds: [response({ client: interaction.client, description: `Ticket logs set to ${channel}`, color: colors.success })] });

    } else if (sub === 'disable') {
      store.setConfig(guild.id, 'ticket_enabled', false);
      await interaction.reply({ embeds: [response({ client: interaction.client, description: 'Ticket system disabled.', color: colors.muted })] });

    } else {
      const enabled = store.getConfig(guild.id, 'ticket_enabled') === true;
      const role = store.getConfig(guild.id, 'ticket_support_role');
      const cat = store.getConfig(guild.id, 'ticket_category');
      const logs = store.getConfig(guild.id, 'ticket_logs');

      await interaction.reply({
        embeds: [response({
          client: interaction.client,
          description: `**Status** ${enabled ? '🟢 Enabled' : '🔴 Disabled'}\n**Support Role** ${role ? `<@&${role}>` : 'Not set'}\n**Category** ${cat ? `<#${cat}>` : 'Default'}\n**Logs** ${logs ? `<#${logs}>` : 'Not set'}`,
          color: enabled ? colors.success : colors.muted,
        })],
      });
    }
  },
};
