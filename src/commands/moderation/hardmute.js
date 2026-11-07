const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response, modAction, dmNotice } = require('../../utils/embed');
const store = require('../../database/store');
const modlog = require('../../utils/modlog');
const { reasonError, memberProblem, splitRoles, restorableRoles } = require('../../utils/modguard');
const { send, ensureDeferred, applyRoleOverwrites, failureText } = require('../../utils/bulk');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hardmute')
    .setDescription('Hardmute or unhardmute a member')
    .addSubcommand((s) =>
      s.setName('add')
        .setDescription('Hardmute a member — strips all roles and adds mute role')
        .addUserOption((o) => o.setName('user').setDescription('Member to hardmute').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason'))
    )
    .addSubcommand((s) =>
      s.setName('remove')
        .setDescription('Remove hardmute from a member')
        .addUserOption((o) => o.setName('user').setDescription('Member to unhardmute').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason'))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    if (!target) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'User not found.', color: colors.error })], ephemeral: true });
    }

    if (sub === 'add') {
      if (target.id === interaction.user.id) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: "You can't hardmute yourself.", color: colors.error })], ephemeral: true });
      }

      const reasonErr = reasonError(reason);
      if (reasonErr) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: reasonErr, color: colors.error })], ephemeral: true });
      }

      const problem = memberProblem(interaction.guild, interaction.member, target, 'hardmute');
      if (problem) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: problem, color: colors.error })], ephemeral: true });
      }

      // Never overwrite the saved roles of someone already hardmuted (or jailed): that would lose their real roles.
      const existingMuteRole = interaction.guild.roles.cache.find((r) => r.name === 'Hardmuted');
      const jailedRole = interaction.guild.roles.cache.find((r) => r.name === 'Jailed');
      if ((existingMuteRole && target.roles.cache.has(existingMuteRole.id))
        || (jailedRole && target.roles.cache.has(jailedRole.id))
        || store.getConfig(interaction.guild.id, `hardmute_roles_${target.id}`)
        || store.getConfig(interaction.guild.id, `jail_roles_${target.id}`)) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'That member is already hardmuted or jailed. Release them first.', color: colors.error })], ephemeral: true });
      }

      let muteRole = interaction.guild.roles.cache.find((r) => r.name === 'Hardmuted');
      if (!muteRole) {
        await ensureDeferred(interaction); // first use: role + per-channel setup can take well over 3 seconds
        muteRole = await interaction.guild.roles.create({
          name: 'Hardmuted',
          color: 0x2c2f33,
          permissions: [],
          reason: '[sonder] Auto-created hardmute role',
        });
      }

      // Only channels still missing the overwrite are touched, so a partial failure last time is retried now.
      const setup = await applyRoleOverwrites(interaction, muteRole, {
        SendMessages: false,
        AddReactions: false,
        Speak: false,
        Connect: false,
        AttachFiles: false,
        EmbedLinks: false,
      }, { reason: '[sonder] Hardmute role setup' });

      if (!muteRole.editable) {
        return send(interaction, { embeds: [response({ client: interaction.client, description: "I can't assign the Hardmuted role (it is above my highest role).", color: colors.error })], ephemeral: true });
      }

      // Managed roles and roles above the bot can't be removed; they stay on the member.
      const { saved: savedRoles, kept } = splitRoles(interaction.guild, target);
      store.setConfig(interaction.guild.id, `hardmute_roles_${target.id}`, savedRoles);

      try {
        await target.roles.set([muteRole.id, ...kept], `Hardmuted by ${interaction.user.tag}: ${reason}`);
      } catch {
        // unwind: nothing changed on the member, so forget the saved list
        store.setConfig(interaction.guild.id, `hardmute_roles_${target.id}`, null);
        return send(interaction, { embeds: [response({ client: interaction.client, description: "Couldn't hardmute that member. Check my permissions and role position.", color: colors.error })], ephemeral: true });
      }

      await target.user.send({ embeds: [dmNotice({ guild: interaction.guild, action: 'Hardmuted', reason, color: colors.error })] }).catch(() => {});

      const embed = modAction({
        client: interaction.client, action: 'Hardmute', color: colors.error,
        target: target.user, moderator: interaction.user, reason,
      });

      const warnText = failureText(setup.failedNames);
      await send(interaction, { embeds: warnText ? [embed, response({ client: interaction.client, description: warnText, color: colors.warning })] : [embed] });
      await modlog.send(interaction.guild, { action: 'Hardmute', target: target.user, moderator: interaction.user, reason });
    } else if (sub === 'remove') {
      const muteRole = interaction.guild.roles.cache.find((r) => r.name === 'Hardmuted');
      if (!muteRole || !target.roles.cache.has(muteRole.id)) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'User is not hardmuted.', color: colors.error })], ephemeral: true });
      }

      const reasonErr = reasonError(reason);
      if (reasonErr) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: reasonErr, color: colors.error })], ephemeral: true });
      }

      const savedRoles = store.getConfig(interaction.guild.id, `hardmute_roles_${target.id}`) || [];
      try {
        await target.roles.set(restorableRoles(interaction.guild, target, savedRoles, muteRole.id), `Unhardmuted by ${interaction.user.tag}: ${reason}`);
      } catch {
        // keep the saved roles so the release can be retried
        return interaction.reply({ embeds: [response({ client: interaction.client, description: "Couldn't release that member. Check my permissions and role position.", color: colors.error })], ephemeral: true });
      }
      store.setConfig(interaction.guild.id, `hardmute_roles_${target.id}`, null);

      const embed = modAction({
        client: interaction.client, action: 'Unhardmute', color: colors.success,
        target: target.user, moderator: interaction.user, reason,
      });

      await interaction.reply({ embeds: [embed] });
      await modlog.send(interaction.guild, { action: 'Unhardmute', target: target.user, moderator: interaction.user, reason });
    }
  },
};
