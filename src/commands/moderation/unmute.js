const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { modAction, response } = require('../../utils/embed');
const modlog = require('../../utils/modlog');
const { reasonError } = require('../../utils/modguard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Remove timeout from a member')
    .addUserOption((o) => o.setName('user').setDescription('Member to unmute').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason for unmute'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

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

    if (!member.isCommunicationDisabled()) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'This member is not muted.', color: colors.muted })], ephemeral: true });
    }

    await member.timeout(null, reason);

    const embed = modAction({
      client: interaction.client,
      action: 'unmute',
      color: colors.success,
      target: member.user,
      moderator: interaction.user,
      reason,
    });

    await interaction.reply({ embeds: [embed] });
    await modlog.send(interaction.guild, { action: 'unmute', target: member.user, moderator: interaction.user, reason });
  },
};
