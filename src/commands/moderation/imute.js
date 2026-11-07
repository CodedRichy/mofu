const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response, modAction } = require('../../utils/embed');
const modlog = require('../../utils/modlog');
const { reasonError } = require('../../utils/modguard');
const { send, ensureDeferred, applyRoleOverwrites, failureText } = require('../../utils/bulk');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('imute')
    .setDescription('Add or remove image mute from a user')
    .addSubcommand((s) =>
      s.setName('add')
        .setDescription('Mute a user from sending images/attachments')
        .addUserOption((o) => o.setName('user').setDescription('User to image mute').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason'))
    )
    .addSubcommand((s) =>
      s.setName('remove')
        .setDescription('Remove image mute from a user')
        .addUserOption((o) => o.setName('user').setDescription('User to unmute').setRequired(true))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const member = interaction.options.getMember('user');

    if (!member) return interaction.reply({ embeds: [response({ client: interaction.client, description: 'User not found.', color: colors.error })], ephemeral: true });

    if (sub === 'add') {
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const reasonErr = reasonError(reason);
      if (reasonErr) return interaction.reply({ embeds: [response({ client: interaction.client, description: reasonErr, color: colors.error })], ephemeral: true });

      const botMember = interaction.guild.members.me;
      if (member.roles.highest.position >= interaction.member.roles.highest.position) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'You cannot target someone with an equal or higher role.', color: colors.error })], ephemeral: true });
      }
      if (member.roles.highest.position >= botMember.roles.highest.position) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'I cannot target someone with an equal or higher role than mine.', color: colors.error })], ephemeral: true });
      }

      let imuteRole = interaction.guild.roles.cache.find((r) => r.name === 'Image Muted');
      if (!imuteRole) {
        await ensureDeferred(interaction); // first use: role + per-channel setup can take well over 3 seconds
        imuteRole = await interaction.guild.roles.create({
          name: 'Image Muted',
          permissions: [],
          reason: '[sonder] Auto-created image mute role',
        });
      }
      if (member.roles.cache.has(imuteRole.id)) {
        return send(interaction, { embeds: [response({ client: interaction.client, description: 'User is already image muted.', color: colors.error })], ephemeral: true });
      }

      // Only channels still missing the overwrite are touched, so a partial failure last time is retried now.
      const setup = await applyRoleOverwrites(interaction, imuteRole, { AttachFiles: false, EmbedLinks: false }, { reason: '[sonder] Image mute role setup' });

      try {
        await member.roles.add(imuteRole, `Image muted by ${interaction.user.tag}: ${reason}`);
      } catch {
        return send(interaction, { embeds: [response({ client: interaction.client, description: "Couldn't image mute that member. Check my permissions and role position.", color: colors.error })], ephemeral: true });
      }

      const embed = modAction({ client: interaction.client, action: 'Image Mute', color: colors.warning, target: member.user, moderator: interaction.user, reason });
      const warnText = failureText(setup.failedNames);
      await send(interaction, { embeds: warnText ? [embed, response({ client: interaction.client, description: warnText, color: colors.warning })] : [embed] });
      await modlog.send(interaction.guild, { action: 'Image Mute', target: member.user, moderator: interaction.user, reason });
    } else if (sub === 'remove') {
      const imuteRole = interaction.guild.roles.cache.find((r) => r.name === 'Image Muted');
      if (!imuteRole || !member.roles.cache.has(imuteRole.id)) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'User is not image muted.', color: colors.error })], ephemeral: true });
      }

      await member.roles.remove(imuteRole);
      const embed = modAction({ client: interaction.client, action: 'Image Unmute', color: colors.success, target: member.user, moderator: interaction.user, reason: 'Removed' });
      await interaction.reply({ embeds: [embed] });
      await modlog.send(interaction.guild, { action: 'Image Unmute', target: member.user, moderator: interaction.user, reason: 'Removed' });
    }
  },
};
