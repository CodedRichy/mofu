const { SlashCommandBuilder, PermissionFlagsBits, OverwriteType } = require('discord.js');
const { colors } = require('../../utils/constants');
const { fetchAllMembers } = require('../../utils/members');
const { base, response, footer } = require('../../utils/embed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('staleperms')
    .setDescription('Find orphaned permission overrides')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const members = await fetchAllMembers(interaction.guild);
    const channels = interaction.guild.channels.cache;
    const issues = [];

    for (const channel of channels.values()) {
      if (!channel.permissionOverwrites) continue;

      for (const [id, overwrite] of channel.permissionOverwrites.cache) {
        if (id === interaction.guild.id) continue;

        if (overwrite.type === OverwriteType.Member) {
          if (!members.has(id)) {
            issues.push({ channel: channel.name, type: 'Left member', id });
          }
        }

        if (overwrite.type === OverwriteType.Role) {
          const role = interaction.guild.roles.cache.get(id);
          if (!role) {
            issues.push({ channel: channel.name, type: 'Deleted role', id });
          } else if (role.members.size === 0 && !role.managed) {
            issues.push({ channel: channel.name, type: 'Empty role', id, roleName: role.name });
          }
        }
      }
    }

    if (!issues.length) {
      return interaction.editReply({ embeds: [response({ client: interaction.client, description: 'No stale permission overrides found. Channels are clean.', color: colors.success })] });
    }

    const grouped = {};
    for (const issue of issues) {
      const key = issue.type;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(issue);
    }

    const sections = [];
    for (const [type, list] of Object.entries(grouped)) {
      const items = list.slice(0, 8).map((i) => {
        if (i.roleName) return `#${i.channel} → \`${i.roleName}\``;
        return `#${i.channel} → \`${i.id}\``;
      }).join('\n');
      const more = list.length > 8 ? `\n*+${list.length - 8} more*` : '';
      sections.push(`**${type}** (${list.length})\n${items}${more}`);
    }

    const embed = base(interaction.client, colors.warning)
      .setAuthor({ name: `Stale Permissions — ${issues.length} found` })
      .setDescription(sections.join('\n\n'))
      .setFooter(footer(interaction.client, 'Review and clean up via Server Settings → Channels'));

    await interaction.editReply({ embeds: [embed] });
  },
};
