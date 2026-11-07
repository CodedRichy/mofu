const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const { cmdRef } = require('../../utils/invocation');
const store = require('../../database/store');

const KEYS = [
  'prefix', 'welcome_channel', 'welcome_message', 'welcome_card',
  'goodbye_channel', 'goodbye_message', 'goodbye_card',
  'log_channel', 'modlog_channel', 'audit_log_channel',
  'log_message_delete', 'log_message_edit', 'log_member_join',
  'log_member_leave', 'log_role_change', 'log_voice', 'log_nickname',
  'antispam', 'antilink', 'antilink_whitelist', 'antiraid',
  'antiraid_threshold', 'antiraid_action', 'antiraid_account_age',
  'antinuke', 'antinuke_whitelist', 'antinuke_thresholds',
  'ai_automod', 'word_filter',
  'autoroles', 'ticket_enabled', 'ticket_support_role',
  'ticket_category', 'ticket_logs',
  'starboard_channel', 'starboard_threshold', 'starboard_emoji', 'starboard_selfstar',
  'counter_channel', 'leveling', 'levelup_channel',
  'nightwatch', 'confession_channel', 'bump_channel',
];

const KEYS_SET = new Set(KEYS);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Backup or restore server configuration')
    .addSubcommand((sub) => sub.setName('export').setDescription('Export current config as a JSON file'))
    .addSubcommand((sub) =>
      sub
        .setName('import')
        .setDescription('Import config from a JSON file attachment')
        .addAttachmentOption((o) => o.setName('file').setDescription('JSON backup file').setRequired(true)),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild } = interaction;

    if (sub === 'export') {
      const config = {};
      for (const key of KEYS) {
        const value = store.getConfig(guild.id, key);
        if (value !== null && value !== undefined) config[key] = value;
      }

      const data = {
        _meta: {
          guild: guild.name,
          exportedAt: new Date().toISOString(),
          version: 1,
        },
        config,
      };

      const keyCount = Object.keys(config).length;
      const file = new AttachmentBuilder(Buffer.from(JSON.stringify(data, null, 2)), {
        name: `mofu-backup-${guild.id}.json`,
      });

      return interaction.reply({
        embeds: [
          response({
            client: interaction.client,
            description: `Config exported. **${keyCount}** settings backed up.`,
            color: colors.success,
          }),
        ],
        files: [file],
      });
    }

    if (sub === 'import') {
      const attachment = interaction.options.getAttachment('file');

      if (!attachment.name.endsWith('.json')) {
        return interaction.reply({
          embeds: [response({ client: interaction.client, description: `Upload a \`.json\` file exported from ${cmdRef(interaction.guild.id, 'backup export')}.`, color: colors.error })],
          ephemeral: true,
        });
      }

      if (attachment.size > 100_000) {
        return interaction.reply({
          embeds: [response({ client: interaction.client, description: `Backup file too large (max 100KB). Re-export with ${cmdRef(interaction.guild.id, 'backup export')}.`, color: colors.error })],
          ephemeral: true,
        });
      }

      let data;
      try {
        const res = await fetch(attachment.url);
        data = await res.json();
      } catch {
        return interaction.reply({
          embeds: [response({ client: interaction.client, description: "Couldn't read file — make sure it's a valid JSON backup from mofu.", color: colors.error })],
          ephemeral: true,
        });
      }

      if (!data._meta || !data.config || typeof data.config !== 'object' || data._meta.version !== 1) {
        return interaction.reply({
          embeds: [response({ client: interaction.client, description: `This doesn't look like a mofu backup. Use ${cmdRef(interaction.guild.id, 'backup export')} to create one.`, color: colors.error })],
          ephemeral: true,
        });
      }

      let appliedCount = 0;
      const skippedKeys = [];
      for (const [key, value] of Object.entries(data.config)) {
        if (!KEYS_SET.has(key)) {
          skippedKeys.push(key);
          continue;
        }
        store.setConfig(guild.id, key, value);
        appliedCount++;
      }

      let desc = `Config restored. **${appliedCount}** settings imported.`;
      if (skippedKeys.length) {
        desc += `\n\n⚠️ **${skippedKeys.length}** unknown keys skipped: ${skippedKeys.map((k) => `\`${k}\``).join(', ')}`;
      }

      return interaction.reply({
        embeds: [
          response({
            client: interaction.client,
            description: desc,
            color: colors.success,
          }),
        ],
      });
    }
  },
};
