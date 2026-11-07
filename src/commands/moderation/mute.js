const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { modAction, dmNotice, response } = require('../../utils/embed');
const { parse, format } = require('../../utils/duration');
const modlog = require('../../utils/modlog');
const { reasonError } = require('../../utils/modguard');
const presetApply = require('../../utils/presetApply');

const MAX_MS = 2419200000; // 28 days, Discord's timeout cap

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Timeout a member')
    .addUserOption((o) => o.setName('user').setDescription('Member to mute').setRequired(true))
    .addStringOption((o) => o.setName('duration').setDescription('Duration (e.g. 30m, 1h, 1d, 1w) — defaults to 30m'))
    .addStringOption((o) => o.setName('reason').setDescription('Reason for mute'))
    // preset stays LAST; in prefix mode presetApply rejoins it into the reason and reads a preset:NAME token instead
    .addStringOption((o) => o.setName('preset').setDescription('Punishment preset; fills duration and reason you leave out').setMaxLength(512).setAutocomplete(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  autocomplete: (interaction) => presetApply.autocomplete(interaction, 'mute'),

  async execute(interaction) {
    const member = interaction.options.getMember('user');
    const pre = presetApply.fromInteraction(interaction, { action: 'mute', maxMs: MAX_MS });
    if (pre.error) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: pre.error, color: colors.error })], ephemeral: true });
    }
    const durationStr = pre.duration || (pre.durationMs ? null : '30m');
    const reason = pre.reason || 'No reason provided';

    const reasonErr = reasonError(reason);
    if (reasonErr) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: reasonErr, color: colors.error })], ephemeral: true });
    }

    if (!member) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Member not found in server.', color: colors.error })], ephemeral: true });
    }

    if (member.id === interaction.user.id) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: "You can't mute yourself.", color: colors.error })], ephemeral: true });
    }

    if (!member.moderatable) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: "I can't mute this member.", color: colors.error })], ephemeral: true });
    }

    if (member.roles.highest.position >= interaction.member.roles.highest.position) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: "You can't mute someone with a higher or equal role.", color: colors.error })], ephemeral: true });
    }

    const ms = durationStr ? parse(durationStr) : pre.durationMs;
    if (!ms) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Invalid duration. Use: `30m`, `1h`, `1d`, `1w`', color: colors.error })], ephemeral: true });
    }

    if (ms <= 0) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Duration must be a positive value.', color: colors.error })], ephemeral: true });
    }

    if (ms > MAX_MS) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `Duration cannot exceed ${MAX_MS / 86400000} days (Discord's timeout limit).`, color: colors.error })], ephemeral: true });
    }

    const dur = format(ms);
    try {
      await member.timeout(ms, reason);
    } catch {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: "Couldn't mute that member. Check my permissions and role position.", color: colors.error })], ephemeral: true });
    }
    const caseId = modlog.openCase(interaction.guild, { action: 'mute', target: member.user, moderator: interaction.user, reason, duration: dur });
    await member.user.send({ embeds: [dmNotice({ guild: interaction.guild, action: 'muted', reason, color: colors.warning, duration: dur, caseId })] }).catch(() => {});

    const embed = modAction({
      client: interaction.client,
      action: 'mute',
      color: colors.warning,
      target: member.user,
      moderator: interaction.user,
      reason,
      duration: dur,
      extra: pre.note || undefined,
      caseId,
    });

    await interaction.reply({ embeds: [embed] });
    await modlog.send(interaction.guild, { action: 'mute', target: member.user, moderator: interaction.user, reason, duration: dur, extra: pre.note || undefined, caseId });
  },
};
