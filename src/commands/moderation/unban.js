const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { modAction, response } = require('../../utils/embed');
const modlog = require('../../utils/modlog');
const { reasonError } = require('../../utils/modguard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user from the server')
    .addStringOption((o) => o.setName('user_id').setDescription('User ID to unban').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason for unban'))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async execute(interaction) {
    const userId = interaction.options.getString('user_id');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    const fail = (description) =>
      interaction.reply({ embeds: [response({ client: interaction.client, description, color: colors.error })], ephemeral: true });

    const reasonErr = reasonError(reason);
    if (reasonErr) return fail(reasonErr);
    if (!/^\d{15,25}$/.test(userId)) return fail('Provide a valid user ID (numbers only).');

    let ban;
    try {
      ban = await interaction.guild.bans.fetch(userId);
    } catch (err) {
      // 10026 = Unknown Ban; anything else is a permission/API problem, not "not banned"
      if (err?.code === 10026) return fail('That user is not banned.');
      return fail(err?.code === 50013 || err?.code === 50001
        ? "I can't read the ban list. I need the **Ban Members** permission."
        : "Couldn't check the ban list right now. Try again.");
    }

    try {
      await interaction.guild.members.unban(userId, reason);

      const embed = modAction({
        client: interaction.client,
        action: 'unban',
        color: colors.success,
        target: ban.user,
        moderator: interaction.user,
        reason,
      });

      await interaction.reply({ embeds: [embed] });
      await modlog.send(interaction.guild, { action: 'unban', target: ban.user, moderator: interaction.user, reason });
    } catch (err) {
      await fail(err?.code === 10026 ? 'That user is not banned.' : "Couldn't unban that user. Check my permissions.");
    }
  },
};
