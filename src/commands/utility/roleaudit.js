const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { fetchAllMembers } = require('../../utils/members');
const { base, response } = require('../../utils/embed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roleaudit')
    .setDescription('Audit server roles for issues')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    await interaction.deferReply();

    const members = await fetchAllMembers(interaction.guild);
    const roles = interaction.guild.roles.cache.filter((r) => r.id !== interaction.guild.id);

    const issues = [];
    const emptyRoles = [];
    const adminRoles = [];
    const duplicatePerms = new Map();
    let noRoleMembers = 0;

    for (const member of members.values()) {
      if (member.roles.cache.size <= 1) noRoleMembers++;
    }

    for (const role of roles.values()) {
      const memberCount = role.members.size;

      if (memberCount === 0) emptyRoles.push(role.name);

      if (role.permissions.has(PermissionFlagsBits.Administrator) && !role.managed) {
        adminRoles.push(`${role} (${memberCount} members)`);
      }

      const permKey = role.permissions.bitfield.toString();
      if (!duplicatePerms.has(permKey)) duplicatePerms.set(permKey, []);
      duplicatePerms.get(permKey).push(role.name);
    }

    const dupes = [...duplicatePerms.values()].filter((arr) => arr.length > 1 && arr.length <= 5);

    const sections = [`**${roles.size}** roles · **${members.size}** members\n`];

    if (emptyRoles.length) {
      const list = emptyRoles.slice(0, 10).map((r) => `\`${r}\``).join(', ');
      const more = emptyRoles.length > 10 ? ` +${emptyRoles.length - 10} more` : '';
      issues.push(`**Empty Roles** (${emptyRoles.length})\n${list}${more}`);
    }

    if (adminRoles.length) {
      issues.push(`**Admin Roles** (${adminRoles.length})\n${adminRoles.join('\n')}`);
    }

    if (noRoleMembers > 0) {
      issues.push(`**Members with No Roles** ${noRoleMembers}`);
    }

    if (dupes.length) {
      const dupeList = dupes.slice(0, 5).map((arr) => arr.map((r) => `\`${r}\``).join(' = ')).join('\n');
      issues.push(`**Duplicate Permissions**\n${dupeList}`);
    }

    if (!issues.length) {
      sections.push('No issues found — roles look clean.');
    } else {
      sections.push(issues.join('\n\n'));
    }

    const embed = base(interaction.client, colors.primary)
      .setAuthor({ name: 'Role Audit' })
      .setDescription(sections.join('\n'));

    await interaction.editReply({ embeds: [embed] });
  },
};
