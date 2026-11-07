const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const store = require('../../database/store');

// Who may talk to Sonder in plain text ("yo sonder ..."). Administrators can always invoke it.
// With no roles set, only members who can Manage Messages (staff) can invoke it.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('airoles')
    .setDescription('Choose which roles can talk to Sonder in plain text')
    .addSubcommand((sub) =>
      sub.setName('add').setDescription('Let a role invoke Sonder')
        .addRoleOption((o) => o.setName('role').setDescription('Role to allow').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('remove').setDescription('Stop a role from invoking Sonder')
        .addRoleOption((o) => o.setName('role').setDescription('Role to remove').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Show which roles can invoke Sonder'))
    .addSubcommand((sub) => sub.setName('clear').setDescription('Reset to the default (staff with Manage Messages only)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild } = interaction;
    let roles = store.getConfig(guild.id, 'ai_roles') || [];
    const reply = (description, color, ephemeral = false) =>
      interaction.reply({ embeds: [response({ client: interaction.client, description, color })], ephemeral });

    if (sub === 'add') {
      const role = interaction.options.getRole('role');
      if (role.managed) return reply("That's a bot role, pick a normal one.", colors.error, true);
      if (roles.includes(role.id)) return reply(`${role} can already invoke Sonder.`, colors.muted, true);
      roles.push(role.id);
      store.setConfig(guild.id, 'ai_roles', roles);
      return reply(`${role} can now talk to Sonder.`, colors.success);
    }

    if (sub === 'remove') {
      const role = interaction.options.getRole('role');
      if (!roles.includes(role.id)) return reply(`${role} isn't on the list.`, colors.muted, true);
      roles = roles.filter((r) => r !== role.id);
      store.setConfig(guild.id, 'ai_roles', roles);
      return reply(`${role} removed.`, colors.success);
    }

    if (sub === 'list') {
      if (roles.length === 0) return reply('No roles set. Only staff with **Manage Messages** (and administrators) can invoke Sonder.', colors.muted);
      return reply(`**Can invoke Sonder**\n${roles.map((r) => `▸ <@&${r}>`).join('\n')}\n\nAdministrators always can.`, colors.primary);
    }

    store.setConfig(guild.id, 'ai_roles', []);
    return reply('Reset. Only staff with **Manage Messages** (and administrators) can invoke Sonder.', colors.success);
  },
};
