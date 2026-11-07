const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response, modAction } = require('../../utils/embed');
const modlog = require('../../utils/modlog');
const { reasonError } = require('../../utils/modguard');
const { send, ensureDeferred, applyRoleOverwrites, failureText } = require('../../utils/bulk');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rmute')
    .setDescription('Add or remove reaction mute from a user')
    .addSubcommand((s) =>
      s.setName('add')
        .setDescription('Mute a user from adding reactions')
        .addUserOption((o) => o.setName('user').setDescription('User to reaction mute').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason'))
    )
    .addSubcommand((s) =>
      s.setName('remove')
        .setDescription('Remove reaction mute from a user')
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

      let rmuteRole = interaction.guild.roles.cache.find((r) => r.name === 'Reaction Muted');
      if (!rmuteRole) {
        await ensureDeferred(interaction); // first use: role + per-channel setup can take well over 3 seconds
        rmuteRole = await interaction.guild.roles.create({
          name: 'Reaction Muted',
          permissions: [],
          reason: '[mofu] Auto-created reaction mute role',
        });
      }
      if (member.roles.cache.has(rmuteRole.id)) {
        return send(interaction, { embeds: [response({ client: interaction.client, description: 'User is already reaction muted.', color: colors.error })], ephemeral: true });
      }

      // Only channels still missing the overwrite are touched, so a partial failure last time is retried now.
      const setup = await applyRoleOverwrites(interaction, rmuteRole, { AddReactions: false }, { reason: '[mofu] Reaction mute role setup' });

      try {
        await member.roles.add(rmuteRole, `Reaction muted by ${interaction.user.tag}: ${reason}`);
      } catch {
        return send(interaction, { embeds: [response({ client: interaction.client, description: "Couldn't reaction mute that member. Check my permissions and role position.", color: colors.error })], ephemeral: true });
      }

      const embed = modAction({ client: interaction.client, action: 'Reaction Mute', color: colors.warning, target: member.user, moderator: interaction.user, reason });
      const warnText = failureText(setup.failedNames);
      await send(interaction, { embeds: warnText ? [embed, response({ client: interaction.client, description: warnText, color: colors.warning })] : [embed] });
      await modlog.send(interaction.guild, { action: 'Reaction Mute', target: member.user, moderator: interaction.user, reason });
    } else if (sub === 'remove') {
      const rmuteRole = interaction.guild.roles.cache.find((r) => r.name === 'Reaction Muted');
      if (!rmuteRole || !member.roles.cache.has(rmuteRole.id)) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'User is not reaction muted.', color: colors.error })], ephemeral: true });
      }

      await member.roles.remove(rmuteRole);
      const embed = modAction({ client: interaction.client, action: 'Reaction Unmute', color: colors.success, target: member.user, moderator: interaction.user, reason: 'Removed' });
      await interaction.reply({ embeds: [embed] });
      await modlog.send(interaction.guild, { action: 'Reaction Unmute', target: member.user, moderator: interaction.user, reason: 'Removed' });
    }
  },
};
