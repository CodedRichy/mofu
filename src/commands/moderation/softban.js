const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { modAction, dmNotice, response } = require('../../utils/embed');
const modlog = require('../../utils/modlog');
const { reasonError } = require('../../utils/modguard');
const { send, ensureDeferred } = require('../../utils/bulk');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('softban')
    .setDescription('Ban and immediately unban — deletes their messages')
    .addUserOption((o) => o.setName('user').setDescription('Member to softban').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason for softban'))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const member = interaction.guild.members.cache.get(user.id) || await interaction.guild.members.fetch(user.id).catch(() => null);

    const reasonErr = reasonError(reason);
    if (reasonErr) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: reasonErr, color: colors.error })], ephemeral: true });
    }

    if (user.id === interaction.user.id) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: "You can't softban yourself.", color: colors.error })], ephemeral: true });
    }

    if (member) {
      if (!member.bannable) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: "I can't softban this member.", color: colors.error })], ephemeral: true });
      }
      if (interaction.guild.ownerId !== interaction.user.id && member.roles.highest.position >= interaction.member.roles.highest.position) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: "You can't softban someone with a higher or equal role.", color: colors.error })], ephemeral: true });
      }
    }

    // ban lookup + DM + ban + unban are four round trips: ack first so a slash call never times out
    await ensureDeferred(interaction);

    // Already banned: a softban would end in an unban and silently lift the real ban.
    const existing = await interaction.guild.bans.fetch(user.id).catch(() => null);
    if (existing) {
      return send(interaction, { embeds: [response({ client: interaction.client, description: 'That user is already banned. Use `/unban` first if you want a softban.', color: colors.error })], ephemeral: true });
    }

    // The DM can only be delivered before the ban removes the shared server.
    await user.send({ embeds: [dmNotice({ guild: interaction.guild, action: 'softbanned', reason, color: colors.error })] }).catch(() => {});

    try {
      await interaction.guild.members.ban(user, { reason, deleteMessageSeconds: 604800 });
    } catch {
      return send(interaction, { embeds: [response({ client: interaction.client, description: "Couldn't softban that user. Check my permissions and role position.", color: colors.error })], ephemeral: true });
    }
    try {
      await interaction.guild.members.unban(user, 'Softban - auto unban');
    } catch {
      await send(interaction, { embeds: [response({ client: interaction.client, description: "The ban went through but the automatic unban failed. **They are still banned.** Use `/unban`.", color: colors.error })] });
      await modlog.send(interaction.guild, { action: 'ban', target: user, moderator: interaction.user, reason: `${reason} (softban unban failed)` });
      return;
    }

    const caseId = modlog.openCase(interaction.guild, { action: 'softban', target: user, moderator: interaction.user, reason });
    const embed = modAction({
      client: interaction.client,
      action: 'softban',
      caseId,
      color: colors.error,
      target: user,
      moderator: interaction.user,
      reason,
      extra: 'Messages deleted — user can rejoin',
    });

    await send(interaction, { embeds: [embed] });
    await modlog.send(interaction.guild, { action: 'softban', target: user, moderator: interaction.user, reason, caseId });
  },
};
