const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response, footer } = require('../../utils/embed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('inrole')
    .setDescription('List members with a specific role')
    .addRoleOption((o) => o.setName('role').setDescription('Role to check').setRequired(true)),

  async execute(interaction) {
    const role = interaction.options.getRole('role');
    const members = role.members;

    if (!members.size) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `No members have ${role}.`, color: colors.muted })] });
    }

    const list = members.map((m) => m.user.tag).slice(0, 30).join('\n');
    const embed = base(interaction.client, role.color || colors.primary)
      .setAuthor({ name: `Members with ${role.name}` })
      .setDescription(list)
      .setFooter(footer(interaction.client, `${members.size} total members`));

    await interaction.reply({ embeds: [embed] });
  },
};
