const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { fetchAllMembers } = require('../../utils/members');
const { response } = require('../../utils/embed');
const store = require('../../database/store');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nickname')
    .setDescription('Manage member nicknames')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addSubcommand((s) =>
      s.setName('set')
        .setDescription('Change a member\'s nickname')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
        .addStringOption((o) => o.setName('name').setDescription('New nickname (leave empty to reset)').setMaxLength(32))
    )
    .addSubcommand((s) =>
      s.setName('clearall')
        .setDescription('Clear all nicknames in the server')
    )
    .addSubcommand((s) =>
      s.setName('force')
        .setDescription('Lock a nickname on a user — they can\'t change it')
        .addUserOption((o) => o.setName('user').setDescription('Target user').setRequired(true))
        .addStringOption((o) => o.setName('nickname').setDescription('Forced nickname').setRequired(true).setMaxLength(32))
    )
    .addSubcommand((s) =>
      s.setName('unforce')
        .setDescription('Remove a forced nickname — user can change it again')
        .addUserOption((o) => o.setName('user').setDescription('Target user').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const member = interaction.options.getMember('user');
      const name = interaction.options.getString('name') || null;

      if (!member) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'User not found.', color: colors.error })], ephemeral: true });
      }

      if (member.roles.highest.position > interaction.member.roles.highest.position) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Target has a higher role.', color: colors.error })], ephemeral: true });
      }

      await member.setNickname(name, `Changed by ${interaction.user.tag}`);
      await interaction.reply({
        embeds: [response({
          client: interaction.client,
          description: name ? `Nickname set to **${name}** for ${member}` : `Nickname reset for ${member}`,
          color: colors.success,
        })],
      });
    }

    if (sub === 'clearall') {
      await interaction.deferReply();

      const members = await fetchAllMembers(interaction.guild);
      const withNicks = members.filter((m) => m.nickname && m.manageable);
      let cleared = 0;

      for (const m of withNicks.values()) {
        try {
          await m.setNickname(null);
          cleared++;
        } catch {
          // Can't manage this member
        }
      }

      await interaction.editReply({
        embeds: [response({ client: interaction.client, description: `Cleared **${cleared}** nickname${cleared !== 1 ? 's' : ''}.`, color: colors.success })],
      });
    }

    if (sub === 'force') {
      const target = interaction.options.getMember('user');

      if (!target) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'User not found in server.', color: colors.error })], ephemeral: true });
      }

      if (target.id === interaction.user.id) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: "You can't force a nickname on yourself.", color: colors.error })], ephemeral: true });
      }

      if (!target.manageable) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'I cannot manage that user.', color: colors.error })], ephemeral: true });
      }

      if (target.roles.highest.position > interaction.member.roles.highest.position) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: "You can't manage someone with a higher role.", color: colors.error })], ephemeral: true });
      }

      const nickname = interaction.options.getString('nickname');
      store.setConfig(interaction.guild.id, `forcenick_${target.id}`, nickname);

      try {
        await target.setNickname(nickname);
        await interaction.reply({ embeds: [response({ client: interaction.client, description: `Forced nickname **${nickname}** on ${target}`, color: colors.success })] });
      } catch {
        await interaction.reply({ embeds: [response({ client: interaction.client, description: 'Failed to set nickname.', color: colors.error })], ephemeral: true });
      }
    }

    if (sub === 'unforce') {
      const target = interaction.options.getMember('user');

      if (!target) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'User not found in server.', color: colors.error })], ephemeral: true });
      }

      if (target.id === interaction.user.id) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: "You can't unforce a nickname on yourself.", color: colors.error })], ephemeral: true });
      }

      if (!target.manageable) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'I cannot manage that user.', color: colors.error })], ephemeral: true });
      }

      if (target.roles.highest.position > interaction.member.roles.highest.position) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: "You can't manage someone with a higher role.", color: colors.error })], ephemeral: true });
      }

      store.setConfig(interaction.guild.id, `forcenick_${target.id}`, null);

      try {
        await target.setNickname(null);
        await interaction.reply({ embeds: [response({ client: interaction.client, description: `Removed forced nickname from ${target}`, color: colors.success })] });
      } catch {
        await interaction.reply({ embeds: [response({ client: interaction.client, description: 'Failed to remove nickname.', color: colors.error })], ephemeral: true });
      }
    }
  },
};
