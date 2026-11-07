const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response, footer } = require('../../utils/embed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('banlist')
    .setDescription('View server ban list')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async execute(interaction) {
    await interaction.deferReply();

    const bans = await interaction.guild.bans.fetch({ limit: 25 });

    if (!bans.size) {
      return interaction.editReply({ embeds: [response({ client: interaction.client, description: 'No bans found.', color: colors.muted })] });
    }

    const list = bans.map((b) => `**${b.user.tag}** \`${b.user.id}\`${b.reason ? ` — ${b.reason}` : ''}`).join('\n');

    const embed = base(interaction.client, colors.primary)
      .setAuthor({ name: `Ban List — ${interaction.guild.name}` })
      .setDescription(list)
      .setFooter(footer(interaction.client, `${bans.size} bans shown`));

    await interaction.editReply({ embeds: [embed] });
  },
};
