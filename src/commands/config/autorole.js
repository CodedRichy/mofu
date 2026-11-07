const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const store = require('../../database/store');
const { createRole } = require('../../utils/roleCreate');
const { roleProblem } = require('../../utils/modguard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autorole')
    .setDescription('Auto-assign roles to new members')
    .addSubcommand((sub) =>
      sub.setName('add').setDescription('Add a role to auto-assign')
        .addRoleOption((o) => o.setName('role').setDescription('Role to auto-assign').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('remove').setDescription('Remove an auto-assigned role')
        .addRoleOption((o) => o.setName('role').setDescription('Role to remove').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('View all auto-assigned roles'))
    .addSubcommand((sub) => sub.setName('clear').setDescription('Remove all auto-assigned roles'))
    .addSubcommand((sub) => sub.setName('create').setDescription('Create a Member role and set it as autorole'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild } = interaction;
    let roles = store.getConfig(guild.id, 'autoroles') || [];

    if (sub === 'add') {
      const role = interaction.options.getRole('role');

      // managed / @everyone / at-or-above the invoker's top role / above the bot are all refused
      const problem = roleProblem(guild, interaction.member, role);
      if (problem) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: problem, color: colors.error })], ephemeral: true });
      }

      if (roles.includes(role.id)) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `${role} is already an autorole.`, color: colors.muted })], ephemeral: true });
      }

      roles.push(role.id);
      store.setConfig(guild.id, 'autoroles', roles);
      await interaction.reply({ embeds: [response({ client: interaction.client, description: `${role} will be auto-assigned to new members.`, color: colors.success })] });

    } else if (sub === 'remove') {
      const role = interaction.options.getRole('role');

      if (!roles.includes(role.id)) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `${role} is not an autorole.`, color: colors.muted })], ephemeral: true });
      }

      roles = roles.filter((r) => r !== role.id);
      store.setConfig(guild.id, 'autoroles', roles);
      await interaction.reply({ embeds: [response({ client: interaction.client, description: `${role} removed from autoroles.`, color: colors.success })] });

    } else if (sub === 'list') {
      if (roles.length === 0) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'No autoroles configured.', color: colors.muted })] });
      }

      const list = roles.map((r) => `▸ <@&${r}>`).join('\n');
      await interaction.reply({ embeds: [response({ client: interaction.client, description: `**Autoroles**\n${list}`, color: colors.info })] });

    } else if (sub === 'create') {
      const role = await createRole(guild, 'member');
      if (!role) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: "Couldn't create role. Make sure I have **Manage Roles** permission.", color: colors.error })], ephemeral: true });
      }
      if (!roles.includes(role.id)) {
        roles.push(role.id);
        store.setConfig(guild.id, 'autoroles', roles);
      }
      await interaction.reply({ embeds: [response({ client: interaction.client, description: `Created ${role} and set as autorole. New members will receive it automatically.`, color: colors.success })] });

    } else {
      store.setConfig(guild.id, 'autoroles', []);
      await interaction.reply({ embeds: [response({ client: interaction.client, description: 'All autoroles cleared.', color: colors.success })] });
    }
  },
};
