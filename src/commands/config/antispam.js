const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const store = require('../../database/store');
const { SPAM_THRESHOLD, SPAM_WINDOW_MS, SPAM_TIMEOUT_MS } = require('../../utils/automodRules');
const automod = require('../../utils/automod');

const mins = SPAM_TIMEOUT_MS / 60000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('antispam')
    .setDescription('Auto-mute users who spam messages')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('enable').setDescription('Enable anti-spam protection'))
    .addSubcommand((s) => s.setName('disable').setDescription('Disable anti-spam protection'))
    .addSubcommand((s) => s.setName('status').setDescription('View anti-spam status')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'enable') {
      const existing = store.getConfig(guildId, 'antispam');
      if (existing === true) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Anti-spam is already enabled.', color: colors.warning })], ephemeral: true });
      }
      store.setConfig(guildId, 'antispam', true);
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `Anti-spam enabled. Members without Manage Messages who send ${SPAM_THRESHOLD}+ messages in ${SPAM_WINDOW_MS / 1000}s get a ${mins} minute timeout (if I have Moderate Members and a higher role).`, color: colors.success })] });
    }

    if (sub === 'disable') {
      const existing = store.getConfig(guildId, 'antispam');
      if (!existing) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Anti-spam is not currently enabled.', color: colors.warning })], ephemeral: true });
      }
      store.setConfig(guildId, 'antispam', false);
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Anti-spam disabled.', color: colors.muted })] });
    }

    const enabled = store.getConfig(guildId, 'antispam');
    return interaction.reply({ embeds: [response({ client: interaction.client, description: `**Anti-Spam:** ${enabled ? 'Enabled' : 'Disabled'}\n**Threshold:** ${SPAM_THRESHOLD} messages in ${SPAM_WINDOW_MS / 1000}s\n**Action:** ${mins} minute timeout + delete their recent messages${automod.spamRule(guildId) ? '\n**Note:** an `automod` spam rule is set, so its ladder replaces this action' : ''}`, color: colors.primary })] });
  },
};
