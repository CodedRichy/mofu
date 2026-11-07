// Voice guard: two detectors that only PROPOSE.
//  - join-flap: one member changes voice channel FLAP_SWITCHES times within FLAP_WINDOW_MS (soundboard/channel
//    spam by hopping).
//  - voice raid: RAID_ACCOUNTS accounts younger than RAID_MAX_AGE_MS join one channel within RAID_WINDOW_MS.
// Detection is pure (see createTracker, fully testable with a fake clock). When something trips, an alert with a
// confirm button is posted in the modlog channel. Nothing is done until a person presses it, and the presser's real
// permissions and role order are checked again at that moment. Off by default: config key 'voiceguard'.
//
// Limit: the confirm step reuses the AI card machinery in src/ai/actions.js, which lets only ONE user press a card
// (the "invoker"). For an automated alert that user is the server owner. The card also carries `anyoneWithPerm`
// so actions.js can open it to any moderator holding that permission once it learns to read the field.

const FLAP_SWITCHES = 6;
const FLAP_WINDOW_MS = 30 * 1000;
const RAID_ACCOUNTS = 4;
const RAID_WINDOW_MS = 60 * 1000;
const RAID_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;
const ALERT_TTL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TRACKED = 5000;

const isYoung = (createdTimestamp, now = Date.now(), maxAgeMs = RAID_MAX_AGE_MS) =>
  Number.isFinite(createdTimestamp) && now - createdTimestamp < maxAgeMs;

function createTracker({
  flapSwitches = FLAP_SWITCHES, flapWindowMs = FLAP_WINDOW_MS,
  raidAccounts = RAID_ACCOUNTS, raidWindowMs = RAID_WINDOW_MS, cooldownMs = ALERT_COOLDOWN_MS,
} = {}) {
  const switches = new Map(); // `${guild}:${user}` -> [timestamps]
  const youngJoins = new Map(); // `${guild}:${channel}` -> Map(userId -> timestamp)
  const cooldown = new Map(); // alert key -> timestamp

  function gc(now) {
    for (const [k, v] of switches) if (!v.some((t) => now - t <= flapWindowMs)) switches.delete(k);
    for (const [k, m] of youngJoins) {
      for (const [u, t] of m) if (now - t > raidWindowMs) m.delete(u);
      if (!m.size) youngJoins.delete(k);
    }
    for (const [k, t] of cooldown) if (now - t > cooldownMs) cooldown.delete(k);
  }
  function guardSize(now) {
    if (switches.size + youngJoins.size + cooldown.size > MAX_TRACKED) gc(now);
    if (switches.size + youngJoins.size + cooldown.size > MAX_TRACKED) { switches.clear(); youngJoins.clear(); cooldown.clear(); }
  }

  return {
    // A member landed in a channel (join or move). True when they have now done it flapSwitches times in the window.
    trackSwitch(guildId, userId, now = Date.now()) {
      guardSize(now);
      const key = `${guildId}:${userId}`;
      const recent = (switches.get(key) || []).filter((t) => now - t <= flapWindowMs);
      recent.push(now);
      switches.set(key, recent);
      return recent.length >= flapSwitches;
    },
    // A young account joined a channel. Returns the distinct young user ids in the window once there are enough, else null.
    trackYoungJoin(guildId, channelId, userId, now = Date.now()) {
      guardSize(now);
      const key = `${guildId}:${channelId}`;
      const m = youngJoins.get(key) || new Map();
      for (const [u, t] of m) if (now - t > raidWindowMs) m.delete(u);
      m.set(String(userId), now);
      youngJoins.set(key, m);
      return m.size >= raidAccounts ? [...m.keys()] : null;
    },
    // True (and starts the cooldown) when an alert for this key may be posted.
    alertAllowed(key, now = Date.now()) {
      const last = cooldown.get(key);
      if (last !== undefined && now - last < cooldownMs) return false;
      cooldown.set(key, now);
      return true;
    },
    forget(guildId, userId) { switches.delete(`${guildId}:${userId}`); },
    size: () => switches.size + youngJoins.size + cooldown.size,
  };
}

const tracker = createTracker();

// Called from voiceStateUpdate for every state change. `store` is injectable for tests. Returns a finding or null.
function observe(oldState, newState, { now = Date.now(), store, trk = tracker } = {}) {
  const st = store || require('../database/store');
  const guild = newState?.guild;
  if (!guild || st.getConfig(guild.id, 'voiceguard') !== true) return null;
  const member = newState.member;
  if (!member || member.user?.bot) return null;
  const channelId = newState.channelId;
  if (!channelId || channelId === oldState?.channelId) return null; // only arrivals matter

  if (trk.trackSwitch(guild.id, member.id, now) && trk.alertAllowed(`flap:${guild.id}:${member.id}`, now)) {
    trk.forget(guild.id, member.id);
    return { kind: 'flap', guild, channelId, userIds: [member.id] };
  }
  if (isYoung(member.user?.createdTimestamp, now)) {
    const ids = trk.trackYoungJoin(guild.id, channelId, member.id, now);
    if (ids && trk.alertAllowed(`raid:${guild.id}:${channelId}`, now)) return { kind: 'raid', guild, channelId, userIds: ids };
  }
  return null;
}

// Which Discord permissions the presser needs for each button.
const NEED = {
  disconnect: { flag: 'MoveMembers', label: 'Move Members' },
  timeout: { flag: 'ModerateMembers', label: 'Moderate Members' },
};

// Re-checked when the button is pressed: the presser's real permission and role order, then the bot's own reach.
async function validateTarget(guild, presserId, targetId, kind) {
  const need = NEED[kind];
  const presser = await guild.members.fetch({ user: presserId, force: true }).catch(() => null);
  if (!presser) return { error: "couldn't verify your permissions." };
  if (!presser.permissions.has(need.flag)) return { error: `you need the ${need.label} permission.` };
  const target = await guild.members.fetch(targetId).catch(() => null);
  if (!target) return { skip: 'left the server' };
  if (target.id === presser.id) return { skip: 'is you' };
  if (target.id === guild.ownerId) return { skip: 'is the server owner' };
  if (guild.ownerId !== presser.id && target.roles.highest.position >= presser.roles.highest.position) return { skip: 'has a higher or equal role' };
  if (kind === 'timeout' && !target.moderatable) return { skip: 'is out of my reach' };
  if (kind === 'disconnect' && !target.voice?.channelId) return { skip: 'is not in voice any more' };
  return { presser, target };
}

function alertText(finding) {
  const who = finding.userIds.slice(0, 10).map((id) => `<@${id}>`).join(', ');
  if (finding.kind === 'flap') {
    return `${who} switched voice channels ${FLAP_SWITCHES} times within ${Math.round(FLAP_WINDOW_MS / 1000)} seconds, landing in <#${finding.channelId}>.`;
  }
  return `${finding.userIds.length} accounts younger than ${Math.round(RAID_MAX_AGE_MS / 86400000)} days joined <#${finding.channelId}> within ${Math.round(RAID_WINDOW_MS / 1000)} seconds: ${who}.`;
}

// Post the alert + confirm buttons in the modlog channel. Silent when there is no modlog channel.
async function propose(finding, deps = {}) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  const crypto = require('crypto');
  const { colors, BRAND } = require('./constants');
  const { base } = require('./embed');
  const { format } = require('./duration');
  const { shared } = deps.actions || require('../ai/actions');
  const store = deps.store || require('../database/store');
  const modlog = deps.modlog || require('./modlog');
  const log = require('./logger');
  const { pending, resultCard, NO_PINGS, audit } = shared;
  const { guild } = finding;

  const channelId = store.getConfig(guild.id, 'modlog_channel');
  const out = channelId && guild.channels.cache.get(channelId);
  if (!out) return null;

  const idDisc = crypto.randomUUID();
  const idTime = crypto.randomUUID();
  const dur = format(TIMEOUT_MS);
  const label = finding.kind === 'flap' ? 'channel hopping' : 'join burst of new accounts';
  const kindTag = `voiceguard_${finding.kind}`;
  const state = { done: false };
  const approver = guild.ownerId;

  const embed = base(guild.client, colors.warning)
    .setAuthor({ name: 'VOICE ALERT (PROPOSAL)' })
    .setDescription([
      alertText(finding),
      '',
      'Nothing has been done. A person must press a button; permissions and role order are checked again when they do.',
      `**Who can confirm** <@${approver}> (the server owner)`,
    ].join('\n'))
    .setFooter({ text: require('./voicecase').NO_AUDIO_NOTE, iconURL: guild.client?.user?.displayAvatarURL?.() || undefined });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`aiact:${idDisc}:ok`).setLabel('Disconnect').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`aiact:${idTime}:ok`).setLabel(`Disconnect + time out ${dur}`).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`aiact:${idDisc}:no`).setLabel('Dismiss').setStyle(ButtonStyle.Secondary),
  );
  const card = await out.send({ embeds: [embed], components: [row], allowedMentions: NO_PINGS }).catch(() => null);
  if (!card) return null;

  const auditId = audit.record({
    guildId: guild.id, invokerId: approver, targetId: finding.userIds[0], kind: kindTag,
    reason: `${label} in ${finding.channelId} (${finding.userIds.length} member(s))`,
  });

  const settle = () => { state.done = true; for (const id of [idDisc, idTime]) { const p = pending.get(id); if (p) clearTimeout(p.timer); pending.delete(id); } };

  const run = (withTimeout) => async ({ interaction, p, show }) => {
    if (state.done) return show({ embeds: [resultCard({ client: interaction.client, title: 'ALREADY HANDLED', kind: kindTag, note: 'Nothing more was done.', color: colors.muted })] });
    settle();
    const done = [];
    const skipped = [];
    const reason = `${label} (${BRAND} voice alert, confirmed by ${interaction.user.tag})`.slice(0, 512);
    for (const uid of finding.userIds) {
      const v = await validateTarget(guild, interaction.user.id, uid, 'disconnect');
      if (v.error) {
        audit.resolve(auditId, 'rejected', v.error);
        return show({ embeds: [resultCard({ client: interaction.client, title: 'NOT DONE', kind: kindTag, note: v.error, color: colors.error })] });
      }
      if (v.skip) { skipped.push(`<@${uid}> ${v.skip}`); continue; }
      try {
        await v.target.voice.disconnect(reason);
        if (withTimeout) {
          const t = await validateTarget(guild, interaction.user.id, uid, 'timeout');
          if (t.error || t.skip) skipped.push(`<@${uid}> not timed out (${t.error || t.skip})`);
          else await v.target.timeout(TIMEOUT_MS, reason);
        }
        const caseId = modlog.openCase(guild, { action: withTimeout ? 'vc_kick_timeout' : 'vc_kick', target: v.target.user, moderator: interaction.user, reason, duration: withTimeout ? dur : undefined });
        await modlog.send(guild, { action: 'voice alert action', target: v.target.user, moderator: interaction.user, reason, duration: withTimeout ? dur : undefined, caseId }).catch(() => {});
        done.push(`<@${uid}>`);
      } catch (err) {
        skipped.push(`<@${uid}> failed`);
        log.warn(`voiceguard action failed: ${err.message}`);
      }
    }
    audit.resolve(auditId, done.length ? 'executed' : 'failed', skipped.join('; ').slice(0, 190) || null);
    const note = [done.length ? `Disconnected ${done.join(', ')}${withTimeout ? ` and timed out for ${dur}` : ''}.` : 'Nobody was disconnected.', skipped.length ? `Skipped: ${skipped.join(', ')}` : ''].filter(Boolean).join('\n');
    return show({ embeds: [resultCard({ client: interaction.client, title: done.length ? 'DONE' : 'NOT DONE', kind: kindTag, note, color: done.length ? colors.success : colors.error })] });
  };

  const expire = setTimeout(() => {
    if (state.done) return;
    settle();
    audit.resolve(auditId, 'expired');
    card.edit({ embeds: [resultCard({ client: guild.client, title: 'EXPIRED', kind: kindTag, note: 'Nothing was done.', color: colors.muted })], components: [], allowedMentions: NO_PINGS }).catch(() => {});
  }, ALERT_TTL_MS);
  expire.unref?.();
  const sibling = setTimeout(() => pending.delete(idTime), ALERT_TTL_MS);
  sibling.unref?.();

  const common = { guildId: guild.id, invokerId: approver, targetId: finding.userIds[0], dur: null, anyoneWithPerm: 'MoveMembers' };
  pending.set(idDisc, { ...common, auditId, kind: kindTag, timer: expire, onConfirm: run(false) });
  pending.set(idTime, { ...common, auditId, kind: kindTag, timer: sibling, onConfirm: run(true) });
  log.info(`voiceguard alert posted: ${finding.kind} channel=${finding.channelId} users=${finding.userIds.length} guild=${guild.id}`);
  return card;
}

module.exports = {
  FLAP_SWITCHES, FLAP_WINDOW_MS, RAID_ACCOUNTS, RAID_WINDOW_MS, RAID_MAX_AGE_MS, ALERT_COOLDOWN_MS, TIMEOUT_MS,
  isYoung, createTracker, tracker, observe, propose, alertText, _validateTarget: validateTarget,
};
