const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField, ComponentType } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response, footer } = require('../../utils/embed');
const store = require('../../database/store');

const CHANNEL_KEYS = [
  { key: 'welcome_channel', label: 'Welcome channel' },
  { key: 'goodbye_channel', label: 'Goodbye channel' },
  { key: 'log_channel', label: 'Log channel' },
  { key: 'modlog_channel', label: 'Modlog channel' },
  { key: 'audit_log_channel', label: 'Audit log channel' },
  { key: 'starboard_channel', label: 'Starboard channel' },
  { key: 'counter_channel', label: 'Counter channel' },
  { key: 'ticket_logs', label: 'Ticket logs channel' },
  { key: 'levelup_channel', label: 'Level-up channel' },
  { key: 'confession_channel', label: 'Confession channel' },
  { key: 'bump_channel', label: 'Bump reminder channel' },
];

const ROLE_KEYS = [
  { key: 'ticket_support_role', label: 'Ticket support role' },
];

const CHANNEL_NAME_MAP = {
  log_channel: 'sonder-logs',
  modlog_channel: 'modlog',
  audit_log_channel: 'audit-log',
  welcome_channel: 'welcome',
  goodbye_channel: 'goodbye',
  starboard_channel: 'starboard',
  counter_channel: 'counting',
  ticket_logs: 'ticket-logs',
  levelup_channel: 'level-ups',
  confession_channel: 'confessions',
  bump_channel: 'bump',
};

const PRIVATE_CHANNEL_KEYS = new Set([
  'log_channel',
  'modlog_channel',
  'audit_log_channel',
  'ticket_logs',
]);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('configaudit')
    .setDescription('Check your server config for issues')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply();

    const { guild, client } = interaction;
    const guildId = guild.id;
    const broken = [];
    const permissions = [];
    const suggestions = [];

    for (const { key, label } of CHANNEL_KEYS) {
      const id = store.getConfig(guildId, key);
      if (!id) continue;
      const channel = guild.channels.cache.get(id);
      if (!channel) {
        broken.push(`⚠️ **${label}** — channel <#${id}> no longer exists`);
        continue;
      }
      const botPerms = channel.permissionsFor(guild.members.me);
      if (botPerms && !botPerms.has('SendMessages')) {
        permissions.push(`🔒 **${label}** — bot can't send messages in <#${id}>`);
      }
    }

    const autoroles = store.getConfig(guildId, 'autoroles');
    if (Array.isArray(autoroles)) {
      for (const roleId of autoroles) {
        if (!guild.roles.cache.has(roleId)) {
          broken.push(`⚠️ **Autorole** — role \`${roleId}\` no longer exists`);
        }
      }
    }

    for (const { key, label } of ROLE_KEYS) {
      const id = store.getConfig(guildId, key);
      if (!id) continue;
      if (!guild.roles.cache.has(id)) {
        broken.push(`⚠️ **${label}** — role \`${id}\` no longer exists`);
      }
    }

    const ticketCategory = store.getConfig(guildId, 'ticket_category');
    if (ticketCategory && !guild.channels.cache.has(ticketCategory)) {
      broken.push(`⚠️ **Ticket category** — channel <#${ticketCategory}> no longer exists`);
    }

    const welcomeMessage = store.getConfig(guildId, 'welcome_message');
    const welcomeChannel = store.getConfig(guildId, 'welcome_channel');
    if (welcomeMessage && !welcomeChannel) {
      suggestions.push('💡 Welcome message is set but no channel configured');
    }

    const goodbyeMessage = store.getConfig(guildId, 'goodbye_message');
    const goodbyeChannel = store.getConfig(guildId, 'goodbye_channel');
    if (goodbyeMessage && !goodbyeChannel) {
      suggestions.push('💡 Goodbye message is set but no channel configured');
    }

    const starboardThreshold = store.getConfig(guildId, 'starboard_threshold');
    const starboardChannel = store.getConfig(guildId, 'starboard_channel');
    if (starboardThreshold && !starboardChannel) {
      suggestions.push('💡 Starboard threshold is set but no starboard channel configured');
    }

    const levelingEnabled = store.getConfig(guildId, 'leveling') ?? true;
    const levelupChannel = store.getConfig(guildId, 'levelup_channel');
    if (levelingEnabled && !levelupChannel) {
      suggestions.push('💡 Leveling is on but no level-up announcement channel set');
    }

    const issueCount = broken.length + permissions.length + suggestions.length;

    if (issueCount === 0) {
      return interaction.editReply({
        embeds: [response({ client, description: '✓ No issues found by these checks.', color: colors.success })],
      });
    }

    const sections = [];
    if (broken.length) sections.push(broken.join('\n'));
    if (permissions.length) sections.push(permissions.join('\n'));
    if (suggestions.length) sections.push(suggestions.join('\n'));

    const embed = base(client, colors.warning)
      .setAuthor({ name: 'Config Audit', iconURL: client.user.displayAvatarURL() })
      .setDescription(sections.join('\n\n'))
      .setFooter(footer(client, `${issueCount} issue${issueCount === 1 ? '' : 's'} found`));

    // Collect broken channel keys and broken autorole IDs for fix buttons
    const brokenChannelKeys = [];
    for (const { key } of CHANNEL_KEYS) {
      const id = store.getConfig(guildId, key);
      if (id && !guild.channels.cache.get(id)) brokenChannelKeys.push(key);
    }
    if (ticketCategory && !guild.channels.cache.has(ticketCategory)) {
      brokenChannelKeys.push('ticket_category');
    }

    const brokenRoleKeys = [];
    for (const { key } of ROLE_KEYS) {
      const id = store.getConfig(guildId, key);
      if (id && !guild.roles.cache.has(id)) brokenRoleKeys.push(key);
    }

    const brokenAutoroles = [];
    if (Array.isArray(autoroles)) {
      for (const roleId of autoroles) {
        if (!guild.roles.cache.has(roleId)) brokenAutoroles.push(roleId);
      }
    }

    const hasBrokenRefs = brokenChannelKeys.length > 0 || brokenRoleKeys.length > 0 || brokenAutoroles.length > 0;

    if (!hasBrokenRefs) {
      return interaction.editReply({ embeds: [embed] });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('audit_fix_refs')
        .setLabel('Fix Broken Refs')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('audit_create_channels')
        .setLabel('Create Missing Channels')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(brokenChannelKeys.length === 0),
    );

    const msg = await interaction.editReply({ embeds: [embed], components: [row] });

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (i) => i.user.id === interaction.user.id,
      time: 30_000,
    });

    collector.on('collect', async (i) => {
      if (i.customId === 'audit_fix_refs') {
        let fixCount = 0;

        for (const key of brokenChannelKeys) {
          store.setConfig(guildId, key, null);
          fixCount++;
        }

        for (const key of brokenRoleKeys) {
          store.setConfig(guildId, key, null);
          fixCount++;
        }

        if (brokenAutoroles.length > 0) {
          const currentAutoroles = store.getConfig(guildId, 'autoroles');
          if (Array.isArray(currentAutoroles)) {
            const cleaned = currentAutoroles.filter((id) => !brokenAutoroles.includes(id));
            store.setConfig(guildId, 'autoroles', cleaned.length ? cleaned : null);
            fixCount += brokenAutoroles.length;
          }
        }

        await i.update({
          embeds: [response({ client, description: `Cleaned up ${fixCount} broken reference${fixCount === 1 ? '' : 's'}.`, color: colors.success })],
          components: [],
        });
        collector.stop();
      }

      if (i.customId === 'audit_create_channels') {
        let created = 0;
        const failed = [];

        for (const key of brokenChannelKeys) {
          const channelName = CHANNEL_NAME_MAP[key];
          if (!channelName) continue;

          const isPrivate = PRIVATE_CHANNEL_KEYS.has(key);
          try {
            const permissionOverwrites = isPrivate
              ? [{ id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }]
              : [];

            const newChannel = await guild.channels.create({
              name: channelName,
              type: ChannelType.GuildText,
              permissionOverwrites,
            });

            store.setConfig(guildId, key, newChannel.id);
            created++;
          } catch {
            failed.push(channelName);
          }
        }

        const lines = [`Created ${created} channel${created === 1 ? '' : 's'} and updated config.`];
        if (failed.length) {
          lines.push(`Could not create: ${failed.map((n) => `\`${n}\``).join(', ')} (missing permissions).`);
        }

        await i.update({
          embeds: [response({ client, description: lines.join('\n'), color: failed.length ? colors.warning : colors.success })],
          components: [],
        });
        collector.stop();
      }
    });

    collector.on('end', (collected, reason) => {
      if (reason === 'time') {
        msg.edit({ components: [] }).catch(() => {});
      }
    });
  },
};
