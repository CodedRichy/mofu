const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { colors } = require('../../utils/constants');
const { modAction, dmNotice, response } = require('../../utils/embed');
const { parse, format } = require('../../utils/duration');
const modlog = require('../../utils/modlog');
const { reasonError, memberProblem, overwriteState, stateToValue } = require('../../utils/modguard');
const vc = require('../../utils/voicecase');

// Prefix usage (voice moderation):
//   ;vc mute|unmute|deafen|undeafen|kick @member [reason]
//   ;vc ban @member [duration] [reason]     ;vc unban @user [reason]
//   ;vc lockdown #voice [speak:true|false] [reason]     ;vc unlock #voice [reason]
//   ;vc toggle [on|off]     ;vc banrole [@role]
//
// Voice ban: if the server set a ban role with `vc banrole`, the member gets that role (it must deny Connect on your
// voice channels to have an effect); otherwise a Connect deny is put on the member for each voice channel I can edit.
// Lockdown: the @everyone overwrite on ONE channel denies Use Soundboard (and Speak if asked); unlock puts back
// whatever was set before, which is saved when the lockdown starts.

const MAX_BAN_MS = 2419200000; // 28 days, same ceiling as a timeout
const DEFAULT_BAN = '1h';

const say = (i, description, color = colors.error) => i.reply({ embeds: [response({ client: i.client, description, color })], ephemeral: true });
const tagOf = (u) => u?.tag || u?.username || String(u?.id);

// One entry per member-targeting subcommand.
const MEMBER_ACTIONS = {
  mute: { perm: 'MuteMembers', label: 'Mute Members', needVoice: true, needState: null, verb: 'voice mute', dm: 'voice muted', color: colors.warning, run: (m, r) => m.voice.setMute(true, r) },
  unmute: { perm: 'MuteMembers', label: 'Mute Members', needVoice: true, needState: (m) => m.voice.serverMute, stateErr: 'is not server muted', verb: 'voice unmute', dm: 'voice unmuted', color: colors.success, run: (m, r) => m.voice.setMute(false, r) },
  deafen: { perm: 'DeafenMembers', label: 'Deafen Members', needVoice: true, needState: null, verb: 'voice deafen', dm: 'voice deafened', color: colors.warning, run: (m, r) => m.voice.setDeaf(true, r) },
  undeafen: { perm: 'DeafenMembers', label: 'Deafen Members', needVoice: true, needState: (m) => m.voice.serverDeaf, stateErr: 'is not server deafened', verb: 'voice undeafen', dm: 'voice undeafened', color: colors.success, run: (m, r) => m.voice.setDeaf(false, r) },
  kick: { perm: 'MoveMembers', label: 'Move Members', needVoice: true, needState: null, verb: 'voice kick', dm: 'removed from voice', color: colors.warning, run: (m, r) => m.voice.disconnect(r) },
};

function memberOpts(sub) {
  return sub
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(512));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vc')
    .setDescription('Voice moderation: mute, deafen, kick, voice ban, lockdown')
    .addSubcommand((s) => memberOpts(s.setName('mute').setDescription('Server mute a member in voice')))
    .addSubcommand((s) => memberOpts(s.setName('unmute').setDescription('Remove a server mute')))
    .addSubcommand((s) => memberOpts(s.setName('deafen').setDescription('Server deafen a member in voice')))
    .addSubcommand((s) => memberOpts(s.setName('undeafen').setDescription('Remove a server deafen')))
    .addSubcommand((s) => memberOpts(s.setName('kick').setDescription('Disconnect a member from voice')))
    .addSubcommand((s) => s.setName('ban').setDescription('Timed voice ban (they cannot join voice)')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((o) => o.setName('duration').setDescription('Duration (e.g. 30m, 1h, 1d, 1w), default 1h'))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(512)))
    .addSubcommand((s) => s.setName('unban').setDescription('Lift a voice ban')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(512)))
    .addSubcommand((s) => s.setName('lockdown').setDescription('Deny soundboard (and optionally speaking) in one voice channel')
      .addChannelOption((o) => o.setName('channel').setDescription('Voice channel').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice).setRequired(true))
      .addBooleanOption((o) => o.setName('speak').setDescription('Also deny Speak (default: soundboard only)'))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(512)))
    .addSubcommand((s) => s.setName('unlock').setDescription('Undo a voice channel lockdown')
      .addChannelOption((o) => o.setName('channel').setDescription('Voice channel').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice).setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(512)))
    .addSubcommand((s) => s.setName('toggle').setDescription('Turn voice guard alerts on or off (default: off)')
      .addStringOption((o) => o.setName('state').setDescription('on or off (leave empty to see the current state)')
        .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })))
    .addSubcommand((s) => s.setName('banrole').setDescription('Set the role used for voice bans (leave empty to use channel overwrites)')
      .addRoleOption((o) => o.setName('role').setDescription('Role that denies Connect on your voice channels'))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (!interaction.guild) return say(interaction, 'Use this in a server.');
    if (MEMBER_ACTIONS[sub]) return memberAction(interaction, sub);
    if (sub === 'ban') return voiceBan(interaction);
    if (sub === 'unban') return voiceUnban(interaction);
    if (sub === 'lockdown') return lockdown(interaction);
    if (sub === 'unlock') return unlock(interaction);
    if (sub === 'toggle') return toggle(interaction);
    if (sub === 'banrole') return banRole(interaction);
    return say(interaction, 'Pick a subcommand: mute, unmute, deafen, undeafen, kick, ban, unban, lockdown, unlock, toggle, banrole.');
  },
  _MEMBER_ACTIONS: MEMBER_ACTIONS,
};

// Shared preamble: invoker permission, reason length, target member, rank checks. Returns { target, reason } or null (already replied).
async function gate(i, { perm, label, verb }, { needTarget = true } = {}) {
  if (!i.member.permissions.has(PermissionFlagsBits[perm])) { await say(i, `You need the **${label}** permission to use this.`); return null; }
  const reason = i.options.getString('reason') || 'No reason provided';
  const rErr = reasonError(reason);
  if (rErr) { await say(i, rErr); return null; }
  if (!needTarget) return { reason };
  const target = i.options.getMember('user');
  if (!target) { await say(i, 'Member not found in this server.'); return null; }
  if (target.id === i.user.id) { await say(i, `You can't ${verb} yourself.`); return null; }
  if (target.id === i.client.user.id) { await say(i, `I'm not going to ${verb} myself.`); return null; }
  const problem = memberProblem(i.guild, i.member, target, verb);
  if (problem) { await say(i, problem); return null; }
  return { target, reason };
}

const audit = (reason, i) => `${reason} (by ${tagOf(i.user)})`.slice(0, 512);

async function memberAction(i, sub) {
  const spec = MEMBER_ACTIONS[sub];
  const g = await gate(i, spec);
  if (!g) return null;
  const { target, reason } = g;
  if (spec.needVoice && !target.voice?.channelId) return say(i, `${target.displayName} is not in a voice channel.`);
  if (spec.needState && !spec.needState(target)) return say(i, `${target.displayName} ${spec.stateErr}.`, colors.muted);
  try {
    await spec.run(target, audit(reason, i));
  } catch {
    return say(i, `Couldn't do that. Check my permissions and role position.`);
  }
  const caseId = modlog.openCase(i.guild, { action: `vc_${sub}`, target: target.user, moderator: i.user, reason });
  await target.user.send({ embeds: [dmNotice({ guild: i.guild, action: spec.dm, reason, color: spec.color, caseId })] }).catch(() => {});
  await i.reply({ embeds: [modAction({ client: i.client, action: spec.verb, color: spec.color, target: target.user, moderator: i.user, reason, caseId })] });
  await modlog.send(i.guild, { action: spec.verb, target: target.user, moderator: i.user, reason, caseId });
}

async function voiceBan(i) {
  const spec = { perm: 'ModerateMembers', label: 'Moderate Members', verb: 'voice ban' };
  const g = await gate(i, spec);
  if (!g) return null;
  const { target, reason } = g;
  const ms = parse(i.options.getString('duration') || DEFAULT_BAN);
  if (!ms || ms <= 0) return say(i, 'Invalid duration. Use: `30m`, `1h`, `1d`, `1w`');
  if (ms > MAX_BAN_MS) return say(i, `Duration cannot exceed ${MAX_BAN_MS / 86400000} days.`);
  const store = require('../../database/store');
  let applied;
  // Editing up to 100 channel overwrites can outlast the 3s interaction deadline: acknowledge first.
  await i.deferReply();
  try {
    applied = await vc.applyVoiceBan(i.guild, target, { roleId: store.getConfig(i.guild.id, 'voiceban_role'), reason: audit(reason, i) });
  } catch {
    return i.editReply({ embeds: [response({ client: i.client, description: "Couldn't apply the voice ban. I need Manage Channels and Manage Roles on the voice channels, or a ban role I can assign.", color: colors.error })] });
  }
  const dur = format(ms);
  const caseId = modlog.openCase(i.guild, { action: 'vc_ban', target: target.user, moderator: i.user, reason, duration: dur });
  vc.tables().addBan({ guildId: i.guild.id, userId: target.id, expiresAt: Date.now() + ms, method: applied.method, roleId: applied.roleId, caseId, moderatorId: i.user.id });
  await target.user.send({ embeds: [dmNotice({ guild: i.guild, action: 'banned from voice', reason, color: colors.error, duration: dur, caseId })] }).catch(() => {});
  const how = applied.method === 'role' ? 'ban role' : `${applied.touched} voice channel(s)`;
  await i.editReply({ embeds: [modAction({ client: i.client, action: 'voice ban', color: colors.error, target: target.user, moderator: i.user, reason, duration: dur, extra: `Applied through: ${how}`, caseId })] });
  await modlog.send(i.guild, { action: 'voice ban', target: target.user, moderator: i.user, reason, duration: dur, extra: `Applied through: ${how}`, caseId });
}

async function voiceUnban(i) {
  const g = await gate(i, { perm: 'ModerateMembers', label: 'Moderate Members', verb: 'voice unban' }, { needTarget: false });
  if (!g) return null;
  const user = i.options.getUser('user');
  if (!user) return say(i, 'User not found.');
  const row = vc.tables().getBan(i.guild.id, user.id);
  if (!row) return say(i, `${tagOf(user)} has no active voice ban from me.`, colors.muted);
  try {
    await vc.liftVoiceBan(i.guild, row, audit(g.reason, i));
  } catch {
    return say(i, "Couldn't lift the voice ban. Check my permissions.");
  }
  vc.tables().removeBan(i.guild.id, user.id);
  const caseId = modlog.openCase(i.guild, { action: 'vc_unban', target: user, moderator: i.user, reason: g.reason });
  await user.send({ embeds: [dmNotice({ guild: i.guild, action: 'unbanned from voice', reason: g.reason, color: colors.success, caseId })] }).catch(() => {});
  await i.reply({ embeds: [modAction({ client: i.client, action: 'voice unban', color: colors.success, target: user, moderator: i.user, reason: g.reason, caseId })] });
  await modlog.send(i.guild, { action: 'voice unban', target: user, moderator: i.user, reason: g.reason, caseId });
}

function channelGate(i, ch) {
  if (!ch || !ch.isVoiceBased?.()) return 'Pick a voice channel.';
  if (!ch.permissionsFor(i.member)?.has(PermissionFlagsBits.ManageChannels)) return "You need Manage Channels on that channel.";
  if (!ch.manageable) return "I can't edit that channel's permissions.";
  return null;
}

async function lockdown(i) {
  const g = await gate(i, { perm: 'ManageChannels', label: 'Manage Channels', verb: 'lock down' }, { needTarget: false });
  if (!g) return null;
  const ch = i.options.getChannel('channel');
  const problem = channelGate(i, ch);
  if (problem) return say(i, problem);
  if (vc.tables().getLockdown(i.guild.id, ch.id)) return say(i, `${ch} is already locked down. Use unlock first.`, colors.muted);
  const speak = i.options.getBoolean('speak') === true;
  const everyone = i.guild.roles.everyone.id;
  const prev = { UseSoundboard: overwriteState(ch, everyone, 'UseSoundboard'), Speak: overwriteState(ch, everyone, 'Speak') };
  const change = { UseSoundboard: false };
  if (speak) change.Speak = false;
  try {
    await ch.permissionOverwrites.edit(everyone, change, { reason: audit(g.reason, i) });
  } catch {
    return say(i, "Couldn't change that channel's permissions.");
  }
  const caseId = modlog.openCase(i.guild, { action: 'vc_lockdown', moderator: i.user, reason: `${ch.name}: ${g.reason}`.slice(0, 512) });
  vc.tables().addLockdown({ guildId: i.guild.id, channelId: ch.id, prev, caseId, moderatorId: i.user.id });
  const what = speak ? 'soundboard and speaking' : 'soundboard';
  await i.reply({ embeds: [response({ client: i.client, description: `Locked down ${ch}: @everyone can't use the ${what}.${caseId ? ` Case #${caseId}.` : ''}`, color: colors.warning })] });
  await vc.postCaseLog(i.guild, {
    caseId, action: 'vc lockdown', color: colors.warning,
    lines: [`**Channel** <#${ch.id}> \`${ch.id}\``, `**Moderator** ${tagOf(i.user)} \`${i.user.id}\``, `**Denied for @everyone** ${what}`, `**Reason** ${g.reason}`],
  });
}

async function unlock(i) {
  const g = await gate(i, { perm: 'ManageChannels', label: 'Manage Channels', verb: 'unlock' }, { needTarget: false });
  if (!g) return null;
  const ch = i.options.getChannel('channel');
  const problem = channelGate(i, ch);
  if (problem) return say(i, problem);
  const row = vc.tables().getLockdown(i.guild.id, ch.id);
  if (!row) return say(i, `${ch} has no lockdown from me.`, colors.muted);
  const restore = { UseSoundboard: stateToValue(row.prev.UseSoundboard || 'none'), Speak: stateToValue(row.prev.Speak || 'none') };
  try {
    await ch.permissionOverwrites.edit(i.guild.roles.everyone.id, restore, { reason: audit(g.reason, i) });
  } catch {
    return say(i, "Couldn't change that channel's permissions.");
  }
  vc.tables().removeLockdown(i.guild.id, ch.id);
  const caseId = modlog.openCase(i.guild, { action: 'vc_unlock', moderator: i.user, reason: `${ch.name}: ${g.reason}`.slice(0, 512) });
  await i.reply({ embeds: [response({ client: i.client, description: `Unlocked ${ch}. Permissions are back to what they were before the lockdown.${caseId ? ` Case #${caseId}.` : ''}`, color: colors.success })] });
  await vc.postCaseLog(i.guild, {
    caseId, action: 'vc unlock', color: colors.success,
    lines: [`**Channel** <#${ch.id}> \`${ch.id}\``, `**Moderator** ${tagOf(i.user)} \`${i.user.id}\``, `**Reason** ${g.reason}`],
  });
}

async function toggle(i) {
  if (!i.member.permissions.has(PermissionFlagsBits.ManageGuild)) return say(i, 'You need the **Manage Server** permission to use this.');
  const store = require('../../database/store');
  const g = require('../../utils/voiceguard');
  const want = i.options.getString('state');
  if (want) store.setConfig(i.guild.id, 'voiceguard', want === 'on');
  const on = store.getConfig(i.guild.id, 'voiceguard') === true;
  const hasLog = !!store.getConfig(i.guild.id, 'modlog_channel');
  const lines = [
    `Voice guard is **${on ? 'on' : 'off'}**.`,
    `It watches for a member hopping channels (${g.FLAP_SWITCHES} in ${Math.round(g.FLAP_WINDOW_MS / 1000)} seconds) and for ${g.RAID_ACCOUNTS} accounts under ${Math.round(g.RAID_MAX_AGE_MS / 86400000)} days old joining one channel within ${Math.round(g.RAID_WINDOW_MS / 1000)} seconds.`,
    'It only posts a proposal in the modlog channel; a person has to press the button.',
  ];
  if (on && !hasLog) lines.push('There is no modlog channel set, so alerts have nowhere to go yet.');
  await i.reply({ embeds: [response({ client: i.client, description: lines.join('\n'), color: on ? colors.success : colors.muted })] });
}

async function banRole(i) {
  if (!i.member.permissions.has(PermissionFlagsBits.ManageGuild)) return say(i, 'You need the **Manage Server** permission to use this.');
  const store = require('../../database/store');
  const role = i.options.getRole('role');
  if (!role) {
    store.setConfig(i.guild.id, 'voiceban_role', null);
    return i.reply({ embeds: [response({ client: i.client, description: 'Voice bans now use a Connect deny on each voice channel I can edit.', color: colors.success })] });
  }
  if (role.managed || role.id === i.guild.id) return say(i, "That role can't be used for voice bans.");
  if (!role.editable) return say(i, "I can't assign that role (it is at or above my highest role).");
  if (i.guild.ownerId !== i.user.id && role.position >= i.member.roles.highest.position) return say(i, 'That role is at or above your highest role.');
  store.setConfig(i.guild.id, 'voiceban_role', role.id);
  await i.reply({ embeds: [response({ client: i.client, description: `Voice bans will give members ${role}. It only blocks voice if the role denies **Connect** on your voice channels (set that in the channel or category permissions).`, color: colors.success })] });
}
