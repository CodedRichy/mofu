const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response } = require('../../utils/embed');
const store = require('../../database/store');

const CATEGORIES = [
  { label: 'Protection', value: 'protection', emoji: '\u{1F6E1}️', description: 'Antispam, antilink, antiraid' },
  { label: 'Logging', value: 'logging', emoji: '\u{1F4CB}', description: 'Log channel, modlog channel, audit channel' },
  { label: 'Welcome & Goodbye', value: 'welcome', emoji: '\u{1F44B}', description: 'Channels and messages' },
  { label: 'Roles', value: 'roles', emoji: '\u{1F3AD}', description: 'Autorole configuration' },
  { label: 'Features', value: 'features', emoji: '\u{1F3AB}', description: 'Leveling and tickets' },
];

// Keys here must match what the runtime reads (see test/configkeys.test.js).
const PROTECTION_KEYS = [
  { label: 'Antispam', key: 'antispam', def: false },
  { label: 'Antilink', key: 'antilink', def: false },
  { label: 'Antiraid', key: 'antiraid', def: false },
];

// `word_filter` holds the word LIST (not a boolean), so it is shown read-only here.
const FEATURE_KEYS = [
  { label: 'Leveling', key: 'leveling', def: true },
  { label: 'Tickets', key: 'ticket_enabled', def: false },
];

function isOn(guildId, entry) {
  return (store.getConfig(guildId, entry.key) ?? entry.def) === true;
}

function categoryMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('setup_category')
      .setPlaceholder('Select a category to configure')
      .addOptions(CATEGORIES),
  );
}

function backButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('setup_back')
      .setLabel('Back to categories')
      .setStyle(ButtonStyle.Secondary),
  );
}

function createChannelRow(createCustomId, createLabel) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(createCustomId)
      .setLabel(createLabel)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('setup_back')
      .setLabel('Back to categories')
      .setStyle(ButtonStyle.Secondary),
  );
}

async function createChannelForSetup(interaction, guildId, name, isPrivate) {
  const permissionOverwrites = isPrivate
    ? [
        { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      ]
    : [];

  try {
    const ch = await interaction.guild.channels.create({
      name,
      type: ChannelType.GuildText,
      permissionOverwrites,
    });
    return ch;
  } catch {
    const errEmbed = response({
      client: interaction.client,
      description: 'I don\'t have permission to create channels. Please create one manually or give me **Manage Channels**.',
      color: colors.error,
    });
    await interaction.followUp({ embeds: [errEmbed], ephemeral: true }).catch(() => {});
    return null;
  }
}

function overviewEmbed(client) {
  return base(client, colors.primary)
    .setTitle('Server Setup')
    .setDescription('Welcome to Sonder setup! Pick a category to configure.\n\n' +
      CATEGORIES.map((c) => `${c.emoji} **${c.label}** ${colors.muted !== undefined ? '' : ''}${c.description}`).join('\n'));
}

function protectionEmbed(client, guildId) {
  const lines = PROTECTION_KEYS.map((p) => {
    const enabled = isOn(guildId, p);
    return `${enabled ? '\u{1F7E2}' : '\u{1F534}'} **${p.label}** — ${enabled ? 'Enabled' : 'Disabled'}`;
  });
  const words = store.getConfig(guildId, 'word_filter');
  const wordCount = Array.isArray(words) ? words.length : 0;
  lines.push(`\u{1F4DD} **Word Filter** — ${wordCount} word${wordCount === 1 ? '' : 's'} (manage with \`/wordfilter\`)`);
  return base(client, colors.primary)
    .setTitle('\u{1F6E1}️ Protection')
    .setDescription(lines.join('\n') + '\n\nSelect a feature below to toggle it.');
}

function protectionMenu(guildId) {
  const options = PROTECTION_KEYS.map((p) => {
    const enabled = isOn(guildId, p);
    return {
      label: `${enabled ? 'Disable' : 'Enable'} ${p.label}`,
      value: p.key,
      emoji: enabled ? '\u{1F534}' : '\u{1F7E2}',
    };
  });
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('setup_protection')
      .setPlaceholder('Toggle a protection feature')
      .addOptions(options),
  );
}

function loggingEmbed(client, guildId, step) {
  const logCh = store.getConfig(guildId, 'log_channel');
  const modlogCh = store.getConfig(guildId, 'modlog_channel');
  const auditCh = store.getConfig(guildId, 'audit_log_channel');

  if (step === 'log') {
    return base(client, colors.primary)
      .setTitle('\u{1F4CB} Logging — Log Channel')
      .setDescription('Select the channel for general logs.\n\n' +
        `**Log Channel** ${logCh ? `<#${logCh}>` : 'Not set'}\n` +
        `**Modlog Channel** ${modlogCh ? `<#${modlogCh}>` : 'Not set'}\n` +
        `**Audit Channel** ${auditCh ? `<#${auditCh}>` : 'Not set'}`);
  }
  if (step === 'modlog') {
    return base(client, colors.primary)
      .setTitle('\u{1F4CB} Logging — Modlog Channel')
      .setDescription('Select the channel for moderation logs.\n\n' +
        `**Log Channel** ${logCh ? `<#${logCh}>` : 'Not set'}\n` +
        `**Modlog Channel** ${modlogCh ? `<#${modlogCh}>` : 'Not set'}\n` +
        `**Audit Channel** ${auditCh ? `<#${auditCh}>` : 'Not set'}`);
  }
  if (step === 'audit') {
    return base(client, colors.primary)
      .setTitle('\u{1F4CB} Logging — Audit Channel')
      .setDescription('Select the channel for audit logs.\n\n' +
        `**Log Channel** ${logCh ? `<#${logCh}>` : 'Not set'}\n` +
        `**Modlog Channel** ${modlogCh ? `<#${modlogCh}>` : 'Not set'}\n` +
        `**Audit Channel** ${auditCh ? `<#${auditCh}>` : 'Not set'}`);
  }
  return base(client, colors.success)
    .setTitle('\u{1F4CB} Logging Configured')
    .setDescription(
      `**Log Channel** ${logCh ? `<#${logCh}>` : 'Not set'}\n` +
      `**Modlog Channel** ${modlogCh ? `<#${modlogCh}>` : 'Not set'}\n` +
      `**Audit Channel** ${auditCh ? `<#${auditCh}>` : 'Not set'}`);
}

function channelSelectRow(customId) {
  return new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(customId)
      .setChannelTypes(ChannelType.GuildText)
      .setPlaceholder('Select a channel'),
  );
}

function welcomeStepEmbed(client, guildId, step) {
  const wCh = store.getConfig(guildId, 'welcome_channel');
  const wMsg = store.getConfig(guildId, 'welcome_message');
  const gCh = store.getConfig(guildId, 'goodbye_channel');
  const gMsg = store.getConfig(guildId, 'goodbye_message');

  const status =
    `**Welcome Channel** ${wCh ? `<#${wCh}>` : 'Not set'}\n` +
    `**Welcome Message** ${wMsg || 'Default'}\n` +
    `**Goodbye Channel** ${gCh ? `<#${gCh}>` : 'Not set'}\n` +
    `**Goodbye Message** ${gMsg || 'Default'}`;

  if (step === 'welcome_ch') {
    return base(client, colors.primary)
      .setTitle('\u{1F44B} Welcome & Goodbye — Welcome Channel')
      .setDescription('Select the channel for welcome messages.\n\n' + status);
  }
  if (step === 'welcome_msg') {
    return base(client, colors.primary)
      .setTitle('\u{1F44B} Welcome & Goodbye — Welcome Message')
      .setDescription('Choose a welcome message option.\n\n' + status);
  }
  if (step === 'goodbye_ch') {
    return base(client, colors.primary)
      .setTitle('\u{1F44B} Welcome & Goodbye — Goodbye Channel')
      .setDescription('Select the channel for goodbye messages, or skip.\n\n' + status);
  }
  if (step === 'goodbye_msg') {
    return base(client, colors.primary)
      .setTitle('\u{1F44B} Welcome & Goodbye — Goodbye Message')
      .setDescription('Choose a goodbye message option.\n\n' + status);
  }
  return base(client, colors.success)
    .setTitle('\u{1F44B} Welcome & Goodbye Configured')
    .setDescription(status);
}

function featuresEmbed(client, guildId) {
  const lines = FEATURE_KEYS.map((f) => {
    const enabled = isOn(guildId, f);
    return `${enabled ? '\u{1F7E2}' : '\u{1F534}'} **${f.label}** — ${enabled ? 'Enabled' : 'Disabled'}`;
  });
  const sb = store.getConfig(guildId, 'starboard_channel');
  const ct = store.getConfig(guildId, 'counter_channel');
  lines.push(`\u2B50 **Starboard** — ${sb ? `<#${sb}>` : 'Off'} (set with \`/starboard\`)`);
  lines.push(`\u{1F522} **Counter** — ${ct ? `<#${ct}>` : 'Off'} (set with \`/counter\`)`);
  return base(client, colors.primary)
    .setTitle('\u{1F3AB} Features')
    .setDescription(lines.join('\n') + '\n\nSelect a feature below to toggle it. Tickets also need the panel set up with `/ticket`.');
}

function featuresMenu(guildId) {
  const options = FEATURE_KEYS.map((f) => {
    const enabled = isOn(guildId, f);
    return {
      label: `${enabled ? 'Disable' : 'Enable'} ${f.label}`,
      value: f.key,
      emoji: enabled ? '\u{1F534}' : '\u{1F7E2}',
    };
  });
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('setup_features')
      .setPlaceholder('Toggle a feature')
      .addOptions(options),
  );
}

function rolesEmbed(client, guildId) {
  const autoroles = store.getConfig(guildId, 'autoroles') || [];
  const roleList = autoroles.length > 0
    ? autoroles.map((r) => `▸ <@&${r}>`).join('\n')
    : 'None configured';
  return base(client, colors.primary)
    .setTitle('\u{1F3AD} Roles — Autorole')
    .setDescription(`**Current Autorole**\n${roleList}\n\nSelect a role to set as the autorole for new members.`);
}

function disableComponents(message) {
  const rows = message.components.map((row) => {
    const newRow = ActionRowBuilder.from(row);
    newRow.components.forEach((c) => c.setDisabled(true));
    return newRow;
  });
  return message.edit({ components: rows }).catch(() => {});
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Interactive server setup wizard')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const { guild, client } = interaction;
    const guildId = guild.id;
    const userId = interaction.user.id;
    let wizardStep = null;

    const msg = await interaction.reply({
      embeds: [overviewEmbed(client)],
      components: [categoryMenu()],
      fetchReply: true,
    });

    const collector = msg.createMessageComponentCollector({
      filter: (i) => i.user.id === userId,
      time: 300_000,
    });

    collector.on('collect', async (i) => {
      try {
        if (i.customId === 'setup_back') {
          wizardStep = null;
          return await i.update({
            embeds: [overviewEmbed(client)],
            components: [categoryMenu()],
          });
        }

        if (i.customId === 'setup_category') {
          const category = i.values[0];

          if (category === 'protection') {
            wizardStep = 'protection';
            return await i.update({
              embeds: [protectionEmbed(client, guildId)],
              components: [protectionMenu(guildId), backButton()],
            });
          }

          if (category === 'logging') {
            wizardStep = 'logging_log';
            return await i.update({
              embeds: [loggingEmbed(client, guildId, 'log')],
              components: [channelSelectRow('setup_log_channel'), createChannelRow('setup_create_logs', 'Create #sonder-logs')],
            });
          }

          if (category === 'welcome') {
            wizardStep = 'welcome_ch';
            return await i.update({
              embeds: [welcomeStepEmbed(client, guildId, 'welcome_ch')],
              components: [channelSelectRow('setup_welcome_ch'), createChannelRow('setup_create_welcome', 'Create #welcome')],
            });
          }

          if (category === 'roles') {
            wizardStep = 'roles';
            const roleRow = new ActionRowBuilder().addComponents(
              new RoleSelectMenuBuilder()
                .setCustomId('setup_autorole')
                .setPlaceholder('Select a role for autorole'),
            );
            return await i.update({
              embeds: [rolesEmbed(client, guildId)],
              components: [roleRow, backButton()],
            });
          }

          if (category === 'features') {
            wizardStep = 'features';
            return await i.update({
              embeds: [featuresEmbed(client, guildId)],
              components: [featuresMenu(guildId), backButton()],
            });
          }
        }

        if (i.customId === 'setup_protection') {
          const entry = PROTECTION_KEYS.find((p) => p.key === i.values[0]);
          if (!entry) return;
          store.setConfig(guildId, entry.key, !isOn(guildId, entry));
          return await i.update({
            embeds: [protectionEmbed(client, guildId)],
            components: [protectionMenu(guildId), backButton()],
          });
        }

        if (i.customId === 'setup_log_channel') {
          const channelId = i.values[0];
          store.setConfig(guildId, 'log_channel', channelId);
          wizardStep = 'logging_modlog';
          return await i.update({
            embeds: [loggingEmbed(client, guildId, 'modlog')],
            components: [channelSelectRow('setup_modlog_channel'), createChannelRow('setup_create_modlog', 'Create #modlog')],
          });
        }

        if (i.customId === 'setup_modlog_channel') {
          const channelId = i.values[0];
          store.setConfig(guildId, 'modlog_channel', channelId);
          wizardStep = 'logging_audit';
          return await i.update({
            embeds: [loggingEmbed(client, guildId, 'audit')],
            components: [channelSelectRow('setup_audit_channel'), backButton()],
          });
        }

        if (i.customId === 'setup_create_logs') {
          await i.deferUpdate();
          const ch = await createChannelForSetup(i, guildId, 'sonder-logs', true);
          if (!ch) return;
          store.setConfig(guildId, 'log_channel', ch.id);
          wizardStep = 'logging_modlog';
          return await i.editReply({
            embeds: [loggingEmbed(client, guildId, 'modlog')],
            components: [channelSelectRow('setup_modlog_channel'), createChannelRow('setup_create_modlog', 'Create #modlog')],
          });
        }

        if (i.customId === 'setup_create_modlog') {
          await i.deferUpdate();
          const ch = await createChannelForSetup(i, guildId, 'modlog', true);
          if (!ch) return;
          store.setConfig(guildId, 'modlog_channel', ch.id);
          wizardStep = 'logging_audit';
          return await i.editReply({
            embeds: [loggingEmbed(client, guildId, 'audit')],
            components: [channelSelectRow('setup_audit_channel'), backButton()],
          });
        }

        if (i.customId === 'setup_audit_channel') {
          const channelId = i.values[0];
          store.setConfig(guildId, 'audit_log_channel', channelId);
          wizardStep = null;
          return await i.update({
            embeds: [loggingEmbed(client, guildId, 'done')],
            components: [backButton()],
          });
        }

        if (i.customId === 'setup_welcome_ch') {
          const channelId = i.values[0];
          store.setConfig(guildId, 'welcome_channel', channelId);
          wizardStep = 'welcome_msg';
          const msgRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('setup_welcome_msg')
              .setPlaceholder('Choose a welcome message')
              .addOptions([
                { label: 'Use Default', value: 'default', emoji: '✅', description: 'Welcome to {server}, {user}! Member #{membercount}' },
                { label: 'Simple Greeting', value: 'simple', emoji: '\u{1F44B}', description: 'Hey {user}, welcome to {server}!' },
                { label: 'Minimal', value: 'minimal', emoji: '▸', description: '{user} just joined.' },
              ]),
          );
          return await i.update({
            embeds: [welcomeStepEmbed(client, guildId, 'welcome_msg')],
            components: [msgRow, backButton()],
          });
        }

        if (i.customId === 'setup_welcome_msg') {
          const choice = i.values[0];
          const messages = {
            default: 'Welcome to {server}, {user}! You\'re member #{membercount}',
            simple: 'Hey {user}, welcome to {server}!',
            minimal: '{user} just joined.',
          };
          store.setConfig(guildId, 'welcome_message', messages[choice]);
          wizardStep = 'goodbye_ch';
          const goodbyeButtonRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('setup_create_goodbye')
              .setLabel('Create #goodbye')
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId('setup_goodbye_skip')
              .setLabel('Skip Goodbye')
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId('setup_back')
              .setLabel('Back to categories')
              .setStyle(ButtonStyle.Secondary),
          );
          return await i.update({
            embeds: [welcomeStepEmbed(client, guildId, 'goodbye_ch')],
            components: [channelSelectRow('setup_goodbye_ch'), goodbyeButtonRow],
          });
        }

        if (i.customId === 'setup_goodbye_skip') {
          wizardStep = null;
          return await i.update({
            embeds: [welcomeStepEmbed(client, guildId, 'done')],
            components: [backButton()],
          });
        }

        if (i.customId === 'setup_create_welcome') {
          await i.deferUpdate();
          const ch = await createChannelForSetup(i, guildId, 'welcome', false);
          if (!ch) return;
          store.setConfig(guildId, 'welcome_channel', ch.id);
          wizardStep = 'welcome_msg';
          const msgRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('setup_welcome_msg')
              .setPlaceholder('Choose a welcome message')
              .addOptions([
                { label: 'Use Default', value: 'default', emoji: '✅', description: 'Welcome to {server}, {user}! Member #{membercount}' },
                { label: 'Simple Greeting', value: 'simple', emoji: '\u{1F44B}', description: 'Hey {user}, welcome to {server}!' },
                { label: 'Minimal', value: 'minimal', emoji: '▸', description: '{user} just joined.' },
              ]),
          );
          return await i.editReply({
            embeds: [welcomeStepEmbed(client, guildId, 'welcome_msg')],
            components: [msgRow, backButton()],
          });
        }

        if (i.customId === 'setup_create_goodbye') {
          await i.deferUpdate();
          const ch = await createChannelForSetup(i, guildId, 'goodbye', false);
          if (!ch) return;
          store.setConfig(guildId, 'goodbye_channel', ch.id);
          wizardStep = 'goodbye_msg';
          const msgRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('setup_goodbye_msg')
              .setPlaceholder('Choose a goodbye message')
              .addOptions([
                { label: 'Use Default', value: 'default', emoji: '✅', description: '{user.tag} has left {server}. We now have {membercount} members.' },
                { label: 'Simple Farewell', value: 'simple', emoji: '\u{1F44B}', description: 'Goodbye, {user.tag}!' },
                { label: 'Minimal', value: 'minimal', emoji: '▸', description: '{user.tag} left.' },
              ]),
          );
          return await i.editReply({
            embeds: [welcomeStepEmbed(client, guildId, 'goodbye_msg')],
            components: [msgRow, backButton()],
          });
        }

        if (i.customId === 'setup_goodbye_ch') {
          const channelId = i.values[0];
          store.setConfig(guildId, 'goodbye_channel', channelId);
          wizardStep = 'goodbye_msg';
          const msgRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('setup_goodbye_msg')
              .setPlaceholder('Choose a goodbye message')
              .addOptions([
                { label: 'Use Default', value: 'default', emoji: '✅', description: '{user.tag} has left {server}. We now have {membercount} members.' },
                { label: 'Simple Farewell', value: 'simple', emoji: '\u{1F44B}', description: 'Goodbye, {user.tag}!' },
                { label: 'Minimal', value: 'minimal', emoji: '▸', description: '{user.tag} left.' },
              ]),
          );
          return await i.update({
            embeds: [welcomeStepEmbed(client, guildId, 'goodbye_msg')],
            components: [msgRow, backButton()],
          });
        }

        if (i.customId === 'setup_goodbye_msg') {
          const choice = i.values[0];
          const messages = {
            default: '{user.tag} has left {server}. We now have {membercount} members.',
            simple: 'Goodbye, {user.tag}!',
            minimal: '{user.tag} left.',
          };
          store.setConfig(guildId, 'goodbye_message', messages[choice]);
          wizardStep = null;
          return await i.update({
            embeds: [welcomeStepEmbed(client, guildId, 'done')],
            components: [backButton()],
          });
        }

        if (i.customId === 'setup_autorole') {
          const roleId = i.values[0];
          store.setConfig(guildId, 'autoroles', [roleId]);
          const roleRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
              .setCustomId('setup_autorole')
              .setPlaceholder('Select a role for autorole'),
          );
          return await i.update({
            embeds: [rolesEmbed(client, guildId)],
            components: [roleRow, backButton()],
          });
        }

        if (i.customId === 'setup_features') {
          const entry = FEATURE_KEYS.find((f) => f.key === i.values[0]);
          if (!entry) return;
          store.setConfig(guildId, entry.key, !isOn(guildId, entry));
          return await i.update({
            embeds: [featuresEmbed(client, guildId)],
            components: [featuresMenu(guildId), backButton()],
          });
        }
      } catch (err) {
        if (err.code !== 10062) {
          const errEmbed = response({ client, description: 'Something went wrong. Please try again.', color: colors.error });
          await i.reply({ embeds: [errEmbed], ephemeral: true }).catch(() => {});
        }
      }
    });

    collector.on('end', () => {
      disableComponents(msg);
    });
  },
};
