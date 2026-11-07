const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response, modAction, dmNotice } = require('../../utils/embed');
const store = require('../../database/store');
const modlog = require('../../utils/modlog');
const { reasonError, memberProblem, splitRoles, restorableRoles } = require('../../utils/modguard');
const { send, ensureDeferred, applyRoleOverwrites, failureText } = require('../../utils/bulk');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('jail')
    .setDescription('Jail or unjail a member')
    .addSubcommand((s) =>
      s.setName('add')
        .setDescription('Jail a member — strips roles and restricts to jail channel')
        .addUserOption((o) => o.setName('user').setDescription('Member to jail').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason for jailing'))
    )
    .addSubcommand((s) =>
      s.setName('remove')
        .setDescription('Release a member from jail')
        .addUserOption((o) => o.setName('user').setDescription('Member to unjail').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason'))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    if (!target) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'User not found in server.', color: colors.error })], ephemeral: true });
    }

    if (sub === 'add') {
      if (target.id === interaction.user.id) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: "You can't jail yourself.", color: colors.error })], ephemeral: true });
      }

      const reasonErr = reasonError(reason);
      if (reasonErr) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: reasonErr, color: colors.error })], ephemeral: true });
      }

      const problem = memberProblem(interaction.guild, interaction.member, target, 'jail');
      if (problem) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: problem, color: colors.error })], ephemeral: true });
      }

      // Never overwrite the saved roles of someone already jailed (or hardmuted): that would lose their real roles.
      const existingJailRole = interaction.guild.roles.cache.find((r) => r.name === 'Jailed');
      const hardRole = interaction.guild.roles.cache.find((r) => r.name === 'Hardmuted');
      if ((existingJailRole && target.roles.cache.has(existingJailRole.id))
        || (hardRole && target.roles.cache.has(hardRole.id))
        || store.getConfig(interaction.guild.id, `jail_roles_${target.id}`)
        || store.getConfig(interaction.guild.id, `hardmute_roles_${target.id}`)) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'That member is already jailed or hardmuted. Release them first.', color: colors.error })], ephemeral: true });
      }

      let jailRole = interaction.guild.roles.cache.find((r) => r.name === 'Jailed');
      if (!jailRole) {
        await ensureDeferred(interaction); // first use: role + per-channel setup can take well over 3 seconds
        jailRole = await interaction.guild.roles.create({
          name: 'Jailed',
          color: 0x2c2f33,
          permissions: [],
          reason: '[sonder] Auto-created jail role',
        });
      }

      // Every text/voice channel except the jail itself gets a deny. Only channels still missing the overwrite are
      // touched, so a partial failure last time is retried now, and failures are reported below.
      const setup = await applyRoleOverwrites(interaction, jailRole, { ViewChannel: false, SendMessages: false, Connect: false }, {
        filter: (c) => (c.type === ChannelType.GuildText || c.type === ChannelType.GuildVoice) && c.name !== 'jail',
        reason: '[sonder] Jail role setup',
      });

      let jailChannel = interaction.guild.channels.cache.find((c) => c.name === 'jail');
      if (!jailChannel) {
        jailChannel = await interaction.guild.channels.create({
          name: 'jail',
          type: ChannelType.GuildText,
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: jailRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages], deny: [PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
          ],
          reason: '[sonder] Auto-created jail channel',
        });
      } else if (!jailChannel.permissionOverwrites?.cache.has(jailRole.id)) {
        // an existing #jail must let jailed members in, or they would see nothing at all
        await jailChannel.permissionOverwrites?.edit(jailRole, { ViewChannel: true, SendMessages: true }).catch(() => {});
      }

      if (!jailRole.editable) {
        return send(interaction, { embeds: [response({ client: interaction.client, description: "I can't assign the Jailed role (it is above my highest role).", color: colors.error })], ephemeral: true });
      }

      // Managed roles and roles above the bot can't be removed; they stay on the member.
      const { saved: savedRoles, kept } = splitRoles(interaction.guild, target);
      store.setConfig(interaction.guild.id, `jail_roles_${target.id}`, savedRoles);

      try {
        await target.roles.set([jailRole.id, ...kept], `Jailed by ${interaction.user.tag}: ${reason}`);
      } catch {
        // unwind: nothing changed on the member, so forget the saved list
        store.setConfig(interaction.guild.id, `jail_roles_${target.id}`, null);
        return send(interaction, { embeds: [response({ client: interaction.client, description: "Couldn't jail that member. Check my permissions and role position.", color: colors.error })], ephemeral: true });
      }

      await target.user.send({ embeds: [dmNotice({ guild: interaction.guild, action: 'Jailed', reason, color: colors.error })] }).catch(() => {});

      const embed = modAction({
        client: interaction.client, action: 'Jail', color: colors.error,
        target: target.user, moderator: interaction.user, reason,
      });

      const warnText = failureText(setup.failedNames);
      await send(interaction, { embeds: warnText ? [embed, response({ client: interaction.client, description: warnText, color: colors.warning })] : [embed] });
      await modlog.send(interaction.guild, { action: 'Jail', target: target.user, moderator: interaction.user, reason });
    } else if (sub === 'remove') {
      if (target.id === interaction.user.id) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: "You can't unjail yourself.", color: colors.error })], ephemeral: true });
      }

      const jailRole = interaction.guild.roles.cache.find((r) => r.name === 'Jailed');
      if (!jailRole || !target.roles.cache.has(jailRole.id)) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'User is not jailed.', color: colors.error })], ephemeral: true });
      }

      const reasonErr = reasonError(reason);
      if (reasonErr) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: reasonErr, color: colors.error })], ephemeral: true });
      }

      const savedRoles = store.getConfig(interaction.guild.id, `jail_roles_${target.id}`) || [];
      try {
        await target.roles.set(restorableRoles(interaction.guild, target, savedRoles, jailRole.id), `Unjailed by ${interaction.user.tag}: ${reason}`);
      } catch {
        // keep the saved roles so the release can be retried
        return interaction.reply({ embeds: [response({ client: interaction.client, description: "Couldn't release that member. Check my permissions and role position.", color: colors.error })], ephemeral: true });
      }
      store.setConfig(interaction.guild.id, `jail_roles_${target.id}`, null);

      const embed = modAction({
        client: interaction.client, action: 'Unjail', color: colors.success,
        target: target.user, moderator: interaction.user, reason,
      });

      await interaction.reply({ embeds: [embed] });
      await modlog.send(interaction.guild, { action: 'Unjail', target: target.user, moderator: interaction.user, reason });
    }
  },
};
