const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const store = require('../../database/store');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('aimod')
    .setDescription('AI-powered content moderation')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('enable').setDescription('Enable AI automod'))
    .addSubcommand((s) => s.setName('disable').setDescription('Disable AI automod'))
    .addSubcommand((s) => s.setName('status').setDescription('View AI automod status')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'enable') {
      const existing = store.getConfig(guildId, 'ai_automod');
      if (existing === true) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'AI automod is already enabled.', color: colors.warning })], ephemeral: true });
      }
      store.setConfig(guildId, 'ai_automod', true);
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'AI automod enabled. Messages will be scanned for toxic/harmful content.', color: colors.success })] });
    }

    if (sub === 'disable') {
      const existing = store.getConfig(guildId, 'ai_automod');
      if (!existing) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'AI automod is not currently enabled.', color: colors.warning })], ephemeral: true });
      }
      store.setConfig(guildId, 'ai_automod', false);
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'AI automod disabled.', color: colors.muted })] });
    }

    const enabled = store.getConfig(guildId, 'ai_automod');
    return interaction.reply({ embeds: [response({ client: interaction.client, description: `**AI Automod:** ${enabled ? 'Enabled' : 'Disabled'}\n**Model:** GPT-OSS 20B (Groq)\n**Checks:** toxic, hateful, sexual, violent, spam (first 500 characters of messages over 10 characters, from members without Manage Messages)\n**Action:** Delete message + modlog`, color: colors.primary })] });
  },
};
