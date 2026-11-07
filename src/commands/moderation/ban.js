const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { modAction, dmNotice, response } = require('../../utils/embed');
const modlog = require('../../utils/modlog');
const { reasonError } = require('../../utils/modguard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from the server')
    .addUserOption((o) => o.setName('user').setDescription('Member to ban').setRequired(true))
    .addIntegerOption((o) =>
      o.setName('delete_messages').setDescription('Days of messages to delete (0-7)').setMinValue(0).setMaxValue(7)
    )
    // free-text reason must stay LAST: the prefix parser gives every earlier string option a single word
    .addStringOption((o) => o.setName('reason').setDescription('Reason for ban'))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const days = interaction.options.getInteger('delete_messages') || 0;
    const member = interaction.guild.members.cache.get(user.id);

    const reasonErr = reasonError(reason);
    if (reasonErr) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: reasonErr, color: colors.error })], ephemeral: true });
    }

    if (user.id === interaction.user.id) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: "You can't ban yourself.", color: colors.error })], ephemeral: true });
    }

    if (member) {
      if (!member.bannable) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: "I can't ban this member — they have a higher or equal role.", color: colors.error })], ephemeral: true });
      }
      if (member.roles.highest.position >= interaction.member.roles.highest.position) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: "You can't ban someone with a higher or equal role.", color: colors.error })], ephemeral: true });
      }
    }

    // A banned user shares no server with the bot, so the DM can only be delivered first. All checks have passed by here.
    const caseId = modlog.openCase(interaction.guild, { action: 'ban', target: user, moderator: interaction.user, reason });
    await user.send({ embeds: [dmNotice({ guild: interaction.guild, action: 'banned', reason, color: colors.error, caseId })] }).catch(() => {});

    try {
      await interaction.guild.members.ban(user, { reason, deleteMessageSeconds: days * 86400 });
      // a permanent ban replaces any pending tempban, so the expiry sweep must not lift it
      try { require('../../database/infractions').removeTempban(interaction.guild.id, user.id); } catch { /* ignore */ }
    } catch {
      modlog.voidCase(interaction.guild, caseId, 'ban refused');
      return interaction.reply({ embeds: [response({ client: interaction.client, description: "Couldn't ban that user. Check my permissions and role position.", color: colors.error })], ephemeral: true });
    }

    const embed = modAction({
      client: interaction.client,
      action: 'ban',
      color: colors.error,
      target: user,
      moderator: interaction.user,
      reason,
      caseId,
    });

    await interaction.reply({ embeds: [embed] });
    await modlog.send(interaction.guild, { action: 'ban', target: user, moderator: interaction.user, reason, caseId });
  },
};
