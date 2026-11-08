const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { modAction, dmNotice, response } = require('../../utils/embed');
const { parse, format } = require('../../utils/duration');
const modlog = require('../../utils/modlog');
const infractions = require('../../database/infractions');
const { reasonError, memberProblem } = require('../../utils/modguard');
const presetApply = require('../../utils/presetApply');

const MIN_MS = 60000;
const MAX_MS = 365 * 86400000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tempban')
    .setDescription('Ban a member for a set time; they are unbanned automatically')
    .addUserOption((o) => o.setName('user').setDescription('Member to ban').setRequired(true))
    // optional so a preset can supply it; with neither, execute() asks for one. 32 chars fits a prefix preset:NAME token
    .addStringOption((o) => o.setName('duration').setDescription('How long: 30m, 12h, 7d, 2w (max 365d), or leave out to use the preset').setMaxLength(32))
    // free-text reason: the prefix parser gives every earlier string option a single word
    .addStringOption((o) => o.setName('reason').setDescription('Reason for the ban').setMaxLength(512))
    // preset stays LAST; in prefix mode presetApply rejoins it into the reason and reads a preset:NAME token instead
    .addStringOption((o) => o.setName('preset').setDescription('Punishment preset; fills duration and reason you leave out').setMaxLength(512).setAutocomplete(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  autocomplete: (interaction) => presetApply.autocomplete(interaction, 'tempban'),

  async execute(interaction) {
    const fail = (description) => interaction.reply({ embeds: [response({ client: interaction.client, description, color: colors.error })], ephemeral: true });
    const user = interaction.options.getUser('user');
    const pre = presetApply.fromInteraction(interaction, { action: 'tempban', maxMs: MAX_MS });
    if (pre.error) return fail(pre.error);
    if (!pre.duration && !pre.durationMs) return fail('Give a duration (e.g. `7d`) or a tempban preset.');
    const reason = pre.reason || 'No reason provided';
    const ms = pre.duration ? parse(String(pre.duration).trim()) : pre.durationMs;
    const { guild } = interaction;

    if (!user) return fail('Could not find that user.');
    const reasonErr = reasonError(reason);
    if (reasonErr) return fail(reasonErr);
    if (!ms) return fail('Invalid duration. Use: `30m`, `12h`, `7d`, `2w`.');
    if (ms < MIN_MS) return fail('Duration must be at least 1 minute.');
    if (ms > MAX_MS) return fail('Duration cannot exceed 365 days. Use `/ban` for a permanent ban.');
    if (user.id === interaction.user.id) return fail("You can't ban yourself.");
    if (user.id === interaction.client.user.id) return fail("I can't ban myself.");
    if (user.id === guild.ownerId) return fail("You can't ban the server owner.");

    const member = guild.members.cache.get(user.id) || await guild.members.fetch(user.id).catch(() => null);
    if (member) {
      const problem = memberProblem(guild, interaction.member, member, 'ban');
      if (problem) return fail(problem);
      if (!member.bannable) return fail("I can't ban this member: their role is above mine or I lack Ban Members.");
    } else if (!guild.members.me?.permissions?.has(PermissionFlagsBits.BanMembers)) {
      return fail('I need the **Ban Members** permission.');
    }

    const existing = await guild.bans?.fetch(user.id).catch(() => null);
    if (existing) return fail('That user is already banned.');

    const dur = format(ms);
    const expiresAt = Date.now() + ms;
    const caseId = modlog.openCase(guild, { action: 'tempban', target: user, moderator: interaction.user, reason, duration: dur });

    // A banned user shares no server with the bot, so the DM can only go first. Every check has passed by here.
    if (member) {
      await user.send({ embeds: [dmNotice({ guild, action: 'banned', reason, color: colors.error, duration: dur, caseId })] }).catch(() => {});
    }

    try {
      await guild.members.ban(user.id, { reason: `${reason} (tempban ${dur})`.slice(0, 512) });
    } catch {
      modlog.voidCase(guild, caseId, 'ban refused');
      return fail("Couldn't ban that user. Check my permissions and role position.");
    }

    let scheduled = true;
    try {
      infractions.addTempban({ guildId: guild.id, userId: user.id, userTag: user.tag, expiresAt, caseId, moderatorId: interaction.user.id });
    } catch {
      scheduled = false;
    }

    const embed = modAction({
      client: interaction.client,
      action: 'tempban',
      color: colors.error,
      target: user,
      moderator: interaction.user,
      reason,
      duration: dur,
      caseId,
      extra: presetApply.joinExtra(scheduled ? `Unbanned <t:${Math.floor(expiresAt / 1000)}:R>` : 'Could not schedule the unban: remove the ban by hand when it is due.', pre.note),
    });
    await interaction.reply({ embeds: [embed] });
    await modlog.send(guild, { action: 'tempban', target: user, moderator: interaction.user, reason, duration: dur, caseId, extra: presetApply.joinExtra(`Expires <t:${Math.floor(expiresAt / 1000)}:f>`, pre.note) });
  },
};
