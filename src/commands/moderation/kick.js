const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { modAction, dmNotice, response } = require('../../utils/embed');
const modlog = require('../../utils/modlog');
const { reasonError } = require('../../utils/modguard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server')
    .addUserOption((o) => o.setName('user').setDescription('Member to kick').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason for kick'))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  async execute(interaction) {
    const member = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    const reasonErr = reasonError(reason);
    if (reasonErr) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: reasonErr, color: colors.error })], ephemeral: true });
    }

    if (!member) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Member not found in server.', color: colors.error })], ephemeral: true });
    }

    if (member.id === interaction.user.id) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: "You can't kick yourself.", color: colors.error })], ephemeral: true });
    }

    if (!member.kickable) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: "I can't kick this member — they have a higher or equal role.", color: colors.error })], ephemeral: true });
    }

    if (interaction.guild.ownerId !== interaction.user.id && member.roles.highest.position >= interaction.member.roles.highest.position) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: "You can't kick someone with a higher or equal role.", color: colors.error })], ephemeral: true });
    }

    // A kicked member shares no server with the bot afterwards, so the DM can only be delivered first.
    const caseId = modlog.openCase(interaction.guild, { action: 'kick', target: member.user, moderator: interaction.user, reason });
    const dmSent = await member.user.send({ embeds: [dmNotice({ guild: interaction.guild, action: 'kicked', reason, color: colors.warning, caseId })] }).then(() => true, () => false);

    try {
      await member.kick(reason);
    } catch {
      modlog.voidCase(interaction.guild, caseId, 'kick refused');
      // The notice went out before the kick; correct it so the DM does not stand as a lie.
      if (dmSent) await member.user.send({ embeds: [response({ client: interaction.client, description: `The kick from **${interaction.guild.name.slice(0, 100)}** did not go through. You were not kicked.`, color: colors.muted })] }).catch(() => {});
      return interaction.reply({ embeds: [response({ client: interaction.client, description: "Couldn't kick that member. Check my permissions and role position.", color: colors.error })], ephemeral: true });
    }

    const embed = modAction({
      client: interaction.client,
      action: 'kick',
      color: colors.warning,
      target: member.user,
      moderator: interaction.user,
      reason,
      caseId,
    });

    await interaction.reply({ embeds: [embed] });
    await modlog.send(interaction.guild, { action: 'kick', target: member.user, moderator: interaction.user, reason, caseId });
  },
};
