const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { modAction, dmNotice, response } = require('../../utils/embed');
const { parse, format } = require('../../utils/duration');
const modlog = require('../../utils/modlog');
const infractions = require('../../database/infractions');
const { reasonError, memberProblem } = require('../../utils/modguard');

const MIN_MS = 60000;
const MAX_MS = 365 * 86400000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tempban')
    .setDescription('Ban a member for a set time; they are unbanned automatically')
    .addUserOption((o) => o.setName('user').setDescription('Member to ban').setRequired(true))
    .addStringOption((o) => o.setName('duration').setDescription('How long: 30m, 12h, 7d, 2w (max 365d)').setRequired(true).setMaxLength(10))
    // free-text reason must stay LAST: the prefix parser gives every earlier string option a single word
    .addStringOption((o) => o.setName('reason').setDescription('Reason for the ban').setMaxLength(512))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async execute(interaction) {
    const fail = (description) => interaction.reply({ embeds: [response({ client: interaction.client, description, color: colors.error })], ephemeral: true });
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const ms = parse(String(interaction.options.getString('duration') || '').trim());
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
      extra: scheduled ? `Unbanned <t:${Math.floor(expiresAt / 1000)}:R>` : 'Could not schedule the unban: remove the ban by hand when it is due.',
    });
    await interaction.reply({ embeds: [embed] });
    await modlog.send(guild, { action: 'tempban', target: user, moderator: interaction.user, reason, duration: dur, caseId, extra: `Expires <t:${Math.floor(expiresAt / 1000)}:f>` });
  },
};
