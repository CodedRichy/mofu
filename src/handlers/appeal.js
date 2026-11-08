// Appeals: the card posted to the modlog channel and its Approve / Deny buttons (customId `appeal:a:<id>` and
// `appeal:d:<id>`; the rows live in the database, so the buttons keep working after a restart).
// Safety model: approval is a human decision by a DIFFERENT moderator than the one who issued the case; the
// approver's real permissions are re-checked at button press; the outcome is written to the case timeline.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../utils/constants');
const { base, response } = require('../utils/embed');
const { clip } = require('../utils/modguard');

// Tempbans are not listed: a banned user is outside the server and cannot run a guild command, so there is no way in.
const APPEALABLE = Object.freeze(['mute']);
const PREFIX = 'appeal';

// Permission a moderator needs to decide an appeal against this kind of case.
function neededPermission(action) {
  return action === 'tempban' ? PermissionFlagsBits.BanMembers : PermissionFlagsBits.ModerateMembers;
}

// Why this member cannot appeal this case, or null. Same answer for "missing" and "not yours" so case numbers
// of other members are not revealed.
function eligibilityProblem(caseRow, userId) {
  if (!caseRow || String(caseRow.target_id) !== String(userId)) return 'You have no case with that number.';
  if (!APPEALABLE.includes(caseRow.action)) return `Only ${APPEALABLE.join(' and ')} cases can be appealed. Ask a moderator about other cases.`;
  if (caseRow.status !== 'active') return 'That case did not go through, so there is nothing to appeal.';
  return null;
}

// A mute appeal lifts whatever timeout is active now, so it is only allowed for the member's newest active mute
// case (casesNewestFirst: that member's cases, highest case id first). Otherwise an old mild case could be used to
// get a newer, longer timeout lifted.
function isLatestMuteCase(casesNewestFirst, caseId) {
  const latest = (casesNewestFirst || []).find((c) => c.action === 'mute' && c.status === 'active');
  return !!latest && Number(latest.case_id) === Number(caseId);
}

// Why `approverId` may not APPROVE this appeal, or null. Denying has no such rule.
function approvalProblem(appeal, caseRow, approverId) {
  if (String(approverId) === String(appeal.user_id)) return 'You cannot approve your own appeal.';
  if (caseRow && caseRow.moderator_id && String(caseRow.moderator_id) === String(approverId)) {
    return 'You issued this case, so a different moderator has to approve the appeal. You can still deny it.';
  }
  return null;
}

const customId = (verb, id) => `${PREFIX}:${verb}:${id}`;
const parseId = (s) => {
  const m = /^appeal:(a|d):(\d{1,10})$/.exec(String(s));
  return m ? { verb: m[1], id: Number(m[2]) } : null;
};

function buttons(appealId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(customId('a', appealId)).setLabel('Approve').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(customId('d', appealId)).setLabel('Deny').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
}

function appealCard(client, appeal, caseRow, outcome = null) {
  const created = Math.floor(appeal.created_at / 1000);
  const lines = [
    `**Member** ${appeal.user_tag ? clip(appeal.user_tag, 100) : 'unknown'} <@${appeal.user_id}> \`${appeal.user_id}\``,
    `**Case** #${appeal.case_id} (${caseRow ? clip(caseRow.action, 20) : 'unknown'}${caseRow?.duration ? ` ${clip(caseRow.duration, 12)}` : ''})`,
    `**Case reason** ${clip(caseRow?.reason || 'No reason provided', 300)}`,
    `**Issued by** ${caseRow?.moderator_id ? `<@${caseRow.moderator_id}>` : 'unknown'}`,
    `**Appeal** ${clip(appeal.reason, 800)}`,
    `**Filed** <t:${created}:R>`,
  ];
  let color = colors.info;
  if (outcome) {
    color = outcome.status === 'approved' ? colors.success : colors.muted;
    lines.push(`**${outcome.status === 'approved' ? 'Approved' : 'Denied'}** by <@${outcome.by}>${outcome.note ? ` - ${clip(outcome.note, 200)}` : ''}`);
  } else {
    lines.push('A moderator other than the one who issued the case must approve. Anyone with the right permission can deny.');
  }
  return base(client, color).setAuthor({ name: `Appeal #${appeal.appeal_id}${outcome ? ` | ${outcome.status}` : ' | pending'}` }).setDescription(lines.join('\n'));
}

// Post the card. deps (for tests): { appeals, store }. Returns { ok, error? }.
async function postAppeal(guild, appeal, caseRow, deps = {}) {
  const appeals = deps.appeals || require('../database/appeals');
  const store = deps.store || require('../database/store');
  const channelId = store.getConfig(guild.id, 'modlog_channel');
  const channel = channelId && guild.channels.cache.get(channelId);
  if (!channel) return { ok: false, error: 'Staff have not set up a mod log channel, so there is nowhere to send appeals yet.' };
  const msg = await channel.send({
    embeds: [appealCard(guild.client, appeal, caseRow)],
    components: [buttons(appeal.appeal_id)],
    allowedMentions: { parse: [] },
  }).catch(() => null);
  if (!msg) return { ok: false, error: 'I could not post your appeal to the mod log channel. Tell a moderator.' };
  appeals.attachLogMessage(guild.id, appeal.appeal_id, channel.id, msg.id);
  return { ok: true };
}

// Lift the punishment the case recorded. Returns { lifted: bool, note } or throws when Discord refuses.
async function liftPunishment(guild, caseRow, reason, deps = {}) {
  const infractions = deps.infractions || require('../database/infractions');
  if (caseRow.action === 'tempban') {
    try {
      await guild.members.unban(caseRow.target_id, reason);
    } catch (err) {
      if (err?.code !== 10026) throw err; // Unknown Ban: already unbanned by hand, still fine
    }
    infractions.removeTempban(guild.id, caseRow.target_id);
    return { lifted: true, note: 'unbanned' };
  }
  const member = guild.members.cache.get(caseRow.target_id) || await guild.members.fetch(caseRow.target_id).catch(() => null);
  if (member?.isCommunicationDisabled?.()) {
    await member.timeout(null, reason);
    return { lifted: true, note: 'mute removed' };
  }
  return { lifted: false, note: 'was no longer muted' };
}

async function handleButton(interaction, deps = {}) {
  const appeals = deps.appeals || require('../database/appeals');
  const infractions = deps.infractions || require('../database/infractions');
  const modlog = deps.modlog || require('../utils/modlog');
  const parsed = parseId(interaction.customId);
  const { guild, user, client } = interaction;
  // After deferUpdate() the interaction is acknowledged, so errors go out as an ephemeral follow-up instead.
  const fail = (description) => {
    const payload = { embeds: [response({ client, description, color: colors.error })], ephemeral: true };
    return interaction.deferred || interaction.replied ? interaction.followUp(payload) : interaction.reply(payload);
  };
  if (!parsed || !guild) return fail('That appeal button is not valid.');

  const appeal = appeals.getAppeal(guild.id, parsed.id);
  if (!appeal) return fail('That appeal no longer exists.');
  if (appeal.status !== 'pending') return fail(`This appeal was already ${appeal.status}.`);
  const caseRow = infractions.getCase(guild.id, appeal.case_id);
  if (!caseRow) return fail('The case behind this appeal no longer exists.');

  // The real permission is checked now, not when the card was posted.
  if (!interaction.memberPermissions?.has(neededPermission(caseRow.action))) {
    return fail(`You need the ${caseRow.action === 'tempban' ? 'Ban Members' : 'Timeout Members'} permission to decide this appeal.`);
  }

  const approve = parsed.verb === 'a';
  if (approve) {
    const problem = approvalProblem(appeal, caseRow, user.id);
    if (problem) return fail(problem);
  }

  // Claim first: the conditional update lets exactly one click through, so a double click or two moderators
  // pressing at once cannot lift twice or log twice.
  const status = approve ? 'approved' : 'denied';
  const claimed = appeals.resolve(guild.id, appeal.appeal_id, status, user.id);
  if (!claimed) return fail('Someone else already decided this appeal.');

  // Acknowledge inside Discord's 3 second window; lifting the punishment and logging can be slow.
  await interaction.deferUpdate().catch(() => {});

  let outcomeNote = approve ? null : 'Appeal denied';
  if (approve) {
    try {
      const res = await liftPunishment(guild, caseRow, `Appeal #${appeal.appeal_id} approved (case #${caseRow.case_id})`.slice(0, 512), deps);
      outcomeNote = res.note;
    } catch {
      appeals.reopen(guild.id, appeal.appeal_id, user.id);
      return fail('I could not lift the punishment (my permissions or role position). The appeal is still pending.');
    }
  }

  const target = { id: appeal.user_id, tag: appeal.user_tag || appeal.user_id, displayAvatarURL: () => null };
  modlog.openCase(guild, {
    action: `appeal-${status}`,
    target,
    moderator: user,
    reason: `Appeal #${appeal.appeal_id} against case #${caseRow.case_id}${outcomeNote && approve ? ` (${outcomeNote})` : ''}: ${clip(appeal.reason, 300)}`,
  });

  await interaction.editReply({
    embeds: [appealCard(client, claimed, caseRow, { status, by: user.id, note: outcomeNote })],
    components: [buttons(appeal.appeal_id, true)],
    allowedMentions: { parse: [] },
  }).catch(() => {});

  // Best effort: the member may have DMs closed or share no server any more.
  try {
    const member = await client.users.fetch(appeal.user_id);
    await member.send({ embeds: [response({ client, description: `Your appeal (case #${caseRow.case_id}) in **${clip(guild.name, 80)}** was ${status}.`, color: approve ? colors.success : colors.muted })] });
  } catch { /* ignore */ }
}

module.exports = {
  APPEALABLE, neededPermission, eligibilityProblem, isLatestMuteCase, approvalProblem, customId, parseId,
  buttons, appealCard, postAppeal, liftPunishment, handleButton,
};
