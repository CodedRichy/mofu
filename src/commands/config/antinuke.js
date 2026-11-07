const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const store = require('../../database/store');
const antinukeDb = require('../../database/antinuke');

const secs = antinukeDb.WINDOW / 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('antinuke')
    .setDescription('Configure antinuke protection')
    .addSubcommand((sub) => sub.setName('enable').setDescription('Enable antinuke protection'))
    .addSubcommand((sub) => sub.setName('disable').setDescription('Disable antinuke protection'))
    .addSubcommand((sub) =>
      sub.setName('whitelist').setDescription('Whitelist a user from antinuke')
        .addUserOption((o) => o.setName('user').setDescription('User to whitelist').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('unwhitelist').setDescription('Remove a user from whitelist')
        .addUserOption((o) => o.setName('user').setDescription('User to remove').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('threshold').setDescription('Set action threshold')
        .addStringOption((o) =>
          o.setName('action').setDescription('Action type').setRequired(true)
            .addChoices(
              { name: 'Ban', value: 'ban' },
              { name: 'Kick', value: 'kick' },
              { name: 'Channel Delete', value: 'channel_delete' },
              { name: 'Channel Create', value: 'channel_create' },
              { name: 'Role Delete', value: 'role_delete' },
              { name: 'Role Create', value: 'role_create' },
            )
        )
        .addIntegerOption((o) => o.setName('limit').setDescription(`Max actions in ${secs}s before trigger`).setRequired(true).setMinValue(2).setMaxValue(10))
    )
    .addSubcommand((sub) => sub.setName('settings').setDescription('View antinuke settings'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild } = interaction;

    if (guild.ownerId !== interaction.user.id) {
      return interaction.reply({
        embeds: [response({ client: interaction.client, description: 'Only the server owner can configure antinuke.', color: colors.error })],
        ephemeral: true,
      });
    }

    if (sub === 'enable') {
      const existing = store.getConfig(guild.id, 'antinuke');
      if (existing === true) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Anti-nuke is already enabled.', color: colors.warning })], ephemeral: true });
      }
      store.setConfig(guild.id, 'antinuke', true);
      await interaction.reply({ embeds: [response({ client: interaction.client, description: `Antinuke protection **enabled**.\nAnyone (except the owner and whitelist) who passes a threshold within ${secs}s is banned and has their roles removed, and I try to undo the action that tripped it (a deleted channel is recreated without its permission overwrites, a deleted role without its members, created ones are deleted, the ban is lifted; kicks cannot be undone). This needs Ban Members, Manage Roles and a role above theirs; the modlog says which steps worked.`, color: colors.success })] });

    } else if (sub === 'disable') {
      const existing = store.getConfig(guild.id, 'antinuke');
      if (!existing) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Anti-nuke is not currently enabled.', color: colors.warning })], ephemeral: true });
      }
      store.setConfig(guild.id, 'antinuke', false);
      await interaction.reply({ embeds: [response({ client: interaction.client, description: 'Antinuke protection **disabled**.', color: colors.muted })] });

    } else if (sub === 'whitelist') {
      const user = interaction.options.getUser('user');
      const whitelist = store.getConfig(guild.id, 'antinuke_whitelist') || [];
      if (whitelist.includes(user.id)) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `${user} is already whitelisted.`, color: colors.warning })], ephemeral: true });
      }
      whitelist.push(user.id);
      store.setConfig(guild.id, 'antinuke_whitelist', whitelist);
      await interaction.reply({ embeds: [response({ client: interaction.client, description: `${user} added to antinuke whitelist.`, color: colors.success })] });

    } else if (sub === 'unwhitelist') {
      const user = interaction.options.getUser('user');
      const whitelist = store.getConfig(guild.id, 'antinuke_whitelist') || [];
      const idx = whitelist.indexOf(user.id);
      if (idx === -1) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `${user} is not whitelisted.`, color: colors.warning })], ephemeral: true });
      }
      whitelist.splice(idx, 1);
      store.setConfig(guild.id, 'antinuke_whitelist', whitelist);
      await interaction.reply({ embeds: [response({ client: interaction.client, description: `${user} removed from antinuke whitelist.`, color: colors.success })] });

    } else if (sub === 'threshold') {
      const action = interaction.options.getString('action');
      const limit = interaction.options.getInteger('limit');
      const thresholds = store.getConfig(guild.id, 'antinuke_thresholds') || {};
      thresholds[action] = limit;
      store.setConfig(guild.id, 'antinuke_thresholds', thresholds);
      const label = action.replace('_', ' ');
      await interaction.reply({ embeds: [response({ client: interaction.client, description: `Threshold for **${label}** set to **${limit}** actions in ${secs}s.`, color: colors.success })] });

    } else {
      const enabled = store.getConfig(guild.id, 'antinuke') === true;
      const whitelist = store.getConfig(guild.id, 'antinuke_whitelist') || [];
      const thresholds = store.getConfig(guild.id, 'antinuke_thresholds') || {};
      const defaults = antinukeDb.DEFAULTS;

      const thresholdLines = Object.entries(defaults)
        .map(([k, v]) => `**${k.replace('_', ' ')}** — ${thresholds[k] ?? v}`)
        .join('\n');

      const whitelistLines = whitelist.length
        ? whitelist.map((id) => `<@${id}>`).join(', ')
        : 'None';

      await interaction.reply({
        embeds: [response({
          client: interaction.client,
          description: `**Status** ${enabled ? '🟢 Enabled' : '🔴 Disabled'}\n\n**Thresholds** (per ${secs}s)\n${thresholdLines}\n\n**Whitelisted** ${whitelistLines}`,
          color: enabled ? colors.success : colors.muted,
        })],
      });
    }
  },
};
