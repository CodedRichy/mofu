const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const { roleProblem, memberProblem } = require('../../utils/modguard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Add or remove a role from a member')
    .addUserOption((o) => o.setName('user').setDescription('Member to add/remove role from').setRequired(true))
    .addRoleOption((o) => o.setName('role').setDescription('Role to toggle').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    const member = interaction.options.getMember('user');
    const role = interaction.options.getRole('role');

    if (!member) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'User not found.', color: colors.error })], ephemeral: true });
    }

    // the role must be strictly below the invoker's highest (owner excepted) and manageable by the bot
    const roleIssue = roleProblem(interaction.guild, interaction.member, role);
    if (roleIssue) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: roleIssue, color: colors.error })], ephemeral: true });
    }

    // the target must also rank below the invoker (changing your own roles is fine if the role check passed)
    const memberIssue = memberProblem(interaction.guild, interaction.member, member, 'change roles for');
    if (memberIssue) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: memberIssue, color: colors.error })], ephemeral: true });
    }

    try {
      if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role, `Removed by ${interaction.user.tag}`);
        await interaction.reply({ embeds: [response({ client: interaction.client, description: `Removed **${role.name}** from ${member}`, color: colors.muted })] });
      } else {
        await member.roles.add(role, `Added by ${interaction.user.tag}`);
        await interaction.reply({ embeds: [response({ client: interaction.client, description: `Added **${role.name}** to ${member}`, color: colors.success })] });
      }
    } catch {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: "Couldn't change that role. Check my permissions and role position.", color: colors.error })], ephemeral: true });
    }
  },
};
