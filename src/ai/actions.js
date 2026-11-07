// Natural-language moderation actions ("yo sonder mute @user 10m spamming").
//
// Design rules (see the AI-native research in the session notes):
//  - The request is parsed by code (regex), never by a model. A model cannot choose what runs.
//  - The target must be explicitly @mentioned by the invoker.
//  - Authority is the invoker's real Discord permissions + role hierarchy, checked when the card is
//    shown AND again when the button is pressed. The bot's own permissions are never the gate.
//  - Every action needs a confirmation button that only the invoker can press (60s expiry).
//  - Every executed action is tagged "via Sonder AI" in the Discord audit log and the modlog.
const crypto = require('crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { colors } = require('../utils/constants');
const { modAction, dmNotice, response } = require('../utils/embed');
const { parse, format } = require('../utils/duration');
const modlog = require('../utils/modlog');
const store = require('../database/store');
const audit = require('../database/aiActions');
const log = require('../utils/logger');

const PENDING_TTL_MS = 120000;
const MAX_MUTE_MS = 2419200000; // 28 days, Discord's timeout cap
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 10; // AI action proposals per guild per window
const USER_RATE_MAX = 4; // ... and per person per window
const NO_PINGS = { parse: [], repliedUser: false };

const pending = new Map(); // uuid -> pending action
const guildProposals = new Map(); // guildId -> [timestamps]
const userProposals = new Map(); // `${guildId}:${userId}` -> [timestamps]

const UNIT = {
  s: 's', sec: 's', secs: 's', second: 's', seconds: 's',
  m: 'm', min: 'm', mins: 'm', minute: 'm', minutes: 'm',
  h: 'h', hr: 'h', hrs: 'h', hour: 'h', hours: 'h',
  d: 'd', day: 'd', days: 'd',
  w: 'w', week: 'w', weeks: 'w',
};
const MUTE_VERB = /\b(?:mute|timeout|time\s*out|silence|shush)\b/i;
const UNMUTE_VERB = /\bun[-\s]?(?:mute|time\s*out|timeout)\b/i;
const WARN_VERB = /\bwarn\b/i;
const KICK_VERB = /\bkick\b/i;
// regex that captures a typed name right after each verb ("warn kai", "kick @kai")
const NAME_AFTER = {
  unmute: /\bun[-\s]?(?:mute|time\s*out|timeout)\s+@?([^\s<>@,.!?]{3,32})/i,
  warn: /\bwarn\s+@?([^\s<>@,.!?]{3,32})/i,
  kick: /\bkick\s+@?([^\s<>@,.!?]{3,32})/i,
};
const DURATION = /\b(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w)\b/i;
// words that follow "mute" but are not a name ("how do i mute someone", "what does mute do")
const NAME_STOP = new Set(['someone', 'somebody', 'anyone', 'everyone', 'everybody', 'people', 'user', 'users', 'member', 'members', 'him', 'her', 'them', 'his', 'hers', 'this', 'that', 'these', 'those', 'guy', 'girl', 'person', 'me', 'myself', 'you', 'yourself', 'it', 'the', 'and', 'for', 'now', 'please', 'pls', 'again', 'later', 'how', 'what', 'why', 'when', 'who', 'can', 'could', 'should', 'would', 'does', 'did', 'command', 'commands', 'works', 'work', 'mean', 'means', 'role', 'roles', 'feature', 'off', 'out', 'back', 'around', 'down', 'up']);

/**
 * Returns null when the message is not a mute request (so it falls through to normal chat),
 * otherwise { kind: 'mute', targetIds, duration, reason }.
 * A request needs the verb AND at least one explicit @mention of someone other than the bot,
 * and must not be phrased as a question.
 */
function parseMuteIntent(content, botId) {
  if (/\?\s*$/.test(content.trim())) return null;
  // Several verbs in one message ("kick him, he should have been muted"): act on whichever comes first,
  // and never more than one action per message.
  const hits = [['unmute', UNMUTE_VERB], ['warn', WARN_VERB], ['kick', KICK_VERB]]
    .map(([kind, re]) => [kind, content.search(re)]).filter(([, i]) => i >= 0);
  const muteAt = content.search(MUTE_VERB);
  if (muteAt >= 0) hits.push(['mute', muteAt]);
  if (!hits.length) return null;
  hits.sort((a, b) => a[1] - b[1]);
  if (hits[0][0] !== 'mute') return parseSimple(hits[0][0], content, botId);

  const targetIds = [...new Set([...content.matchAll(/<@!?(\d+)>/g)].map((m) => m[1]))].filter((id) => id !== botId);

  let text = content.replace(/<@!?\d+>/g, ' ');
  // No @mention: accept a typed name right after the verb ("mute kai 30s"). It is only a lookup key;
  // proposeMute resolves it to a real member and the confirmation card names who was found.
  let targetName = null;
  if (targetIds.length === 0) {
    const nm = text.match(/\b(?:mute|timeout|time\s*out|silence|shush)\s+@?([^\s<>@,.!?]{3,32})/i);
    if (!nm || /^\d/.test(nm[1]) || NAME_STOP.has(nm[1].toLowerCase())) return null;
    targetName = nm[1];
    text = text.replace(nm[0], ' ');
  }
  let duration = '30m';
  const d = text.match(DURATION);
  if (d) {
    duration = `${d[1]}${UNIT[d[2].toLowerCase()]}`;
    text = text.replace(d[0], ' ');
  }
  const r = text.match(/\b(?:for|because|cuz|since)\s+(.+)$/i);
  const reason = (r ? r[1] : '')
    .replace(/@(everyone|here)/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:(?:because|cuz|since|for)\s+)+/i, '') // "for 2 hours because x" leaves a dangling connector
    .slice(0, 200) || 'No reason provided';

  return { kind: 'mute', targetIds, targetName, duration, reason };
}

// unmute / warn / kick: an explicit target (mention or typed name) plus an optional reason. Never a question.
function parseSimple(kind, content, botId) {
  const targetIds = [...new Set([...content.matchAll(/<@!?(\d+)>/g)].map((m) => m[1]))].filter((id) => id !== botId);
  let text = content.replace(/<@!?\d+>/g, ' ');
  let targetName = null;
  if (targetIds.length === 0) {
    const nm = text.match(NAME_AFTER[kind]);
    if (!nm || /^\d/.test(nm[1]) || NAME_STOP.has(nm[1].toLowerCase())) return null;
    targetName = nm[1];
    text = text.replace(nm[0], ' ');
  }
  const r = text.match(/\b(?:for|because|cuz|since)\s+(.+)$/i);
  const reason = (r ? r[1] : '').replace(/@(everyone|here)/gi, '').replace(/\s+/g, ' ').trim()
    .replace(/^(?:(?:because|cuz|since|for)\s+)+/i, '').slice(0, 200) || 'No reason provided';
  return { kind, targetIds, targetName, duration: null, reason };
}

// A bare "sonder kick" (verb, no target) is clearly an attempt at an action. Answer it from code so the
// chat model can never invent a target, and so the format shown is always the same.
const HINT_FILLER = new Set(['sonder', 'yo', 'hey', 'hi', 'hello', 'please', 'pls', 'plz', 'can', 'you', 'could', 'now', 'just']);
const HINTS = {
  mute: 'mute who? `sonder mute @someone 10m reason`',
  timeout: 'timeout who? `sonder mute @someone 10m reason`',
  unmute: 'unmute who? `sonder unmute @someone`',
  warn: 'warn who? `sonder warn @someone reason`',
  kick: 'kick who? `sonder kick @someone reason`',
};
function usageHint(content, botId = null) {
  // only the bot's own mention is noise; any other @mention means a target was given, so this is not a bare verb
  if ([...content.matchAll(/<@!?(\d+)>/g)].some((m) => m[1] !== botId)) return null;
  const words = content.toLowerCase().replace(/<@!?\d+>/g, ' ').replace(/[^a-z\s]/g, ' ').split(/\s+/)
    .filter((w) => w && !HINT_FILLER.has(w));
  return words.length === 1 ? HINTS[words[0]] || null : null;
}

// Find one member by a typed name. Exact (case-insensitive) match on username / display name wins;
// a single partial match is accepted; anything ambiguous makes the user @mention the person.
async function resolveName(guild, name) {
  const results = await guild.members.search({ query: name, limit: 6 }).catch(() => null);
  if (!results || results.size === 0) return { error: `couldn't find anyone called "${name}". @mention them instead.` };
  const lower = name.toLowerCase();
  const all = [...results.values()];
  const exact = all.filter((m) => [m.user.username, m.displayName, m.user.globalName].some((n) => n && n.toLowerCase() === lower));
  if (exact.length === 1) return { id: exact[0].id };
  if (all.length === 1) return { id: all[0].id };
  return { error: `more than one match for "${name}" (${all.slice(0, 4).map((m) => m.displayName).join(', ')}). @mention the one you mean.` };
}

// Sliding window: allow at most `max` events per RATE_WINDOW_MS for a key; records the event when allowed.
function windowOk(map, key, max, now = Date.now()) {
  const recent = (map.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= max) { map.set(key, recent); return false; }
  recent.push(now);
  map.set(key, recent);
  return true;
}

const rateOk = (guildId) => windowOk(guildProposals, guildId, RATE_MAX);
const userRateOk = (guildId, userId) => windowOk(userProposals, `${guildId}:${userId}`, USER_RATE_MAX);

// One card at a time per person: stops a stack of open confirmations, which would also eat the guild allowance.
function hasPending(guildId, userId) {
  for (const p of pending.values()) if (p.guildId === guildId && p.invokerId === userId) return true;
  return false;
}

// per-user keys would otherwise accumulate forever
setInterval(() => {
  const now = Date.now();
  for (const map of [guildProposals, userProposals]) {
    for (const [k, ts] of map) if (!ts.some((t) => now - t < RATE_WINDOW_MS)) map.delete(k);
  }
}, RATE_WINDOW_MS).unref();

// What the INVOKER must hold for each action (the bot's own permissions are never the gate).
const REQUIRED_PERM = {
  mute: { flag: 'ModerateMembers', label: 'Moderate Members' },
  unmute: { flag: 'ModerateMembers', label: 'Moderate Members' },
  warn: { flag: 'ModerateMembers', label: 'Moderate Members' },
  kick: { flag: 'KickMembers', label: 'Kick Members' },
};

// Shared by the proposal and by the button press. Fresh fetches every time.
async function validateMute(guild, invokerId, targetId, ms, kind = 'mute') {
  const need = REQUIRED_PERM[kind];
  if (!need) return { error: "i can't do that from chat." };
  const invoker = await guild.members.fetch({ user: invokerId, force: true }).catch(() => null);
  if (!invoker) return { error: "couldn't verify your permissions." };
  if (!invoker.permissions.has(need.flag)) return { error: `you need the **${need.label}** permission to do that.` };
  const target = await guild.members.fetch(targetId).catch(() => null);
  if (!target) return { error: "that member isn't in the server." };
  if (target.id === invoker.id) return { error: `you can't ${kind} yourself.` };
  if (target.id === guild.client.user.id) return { error: `i'm not going to ${kind} myself.` };
  if (target.id === guild.ownerId) return { error: `you can't ${kind} the server owner.` };
  if (kind === 'warn' && target.user.bot) return { error: "you can't warn a bot." };
  // can the BOT carry it out? (role order / its own permissions)
  const botCan = kind === 'kick' ? target.kickable : kind === 'warn' ? true : target.moderatable;
  if (!botCan) return { error: `i can't ${kind} that member (their role is above mine, or i'm missing a permission).` };
  if (invoker.id !== guild.ownerId && target.roles.highest.position >= invoker.roles.highest.position) {
    return { error: `you can't ${kind} someone with a higher or equal role.` };
  }
  if (kind === 'warn' || kind === 'kick') return { invoker, target };
  if (kind === 'unmute') {
    if (!target.isCommunicationDisabled()) return { error: `${target.displayName} isn't muted.` };
    return { invoker, target };
  }
  if (!ms || ms <= 0) return { error: 'invalid duration. try `30m`, `1h`, `1d`.' };
  if (ms > MAX_MUTE_MS) return { error: "mutes can't be longer than 28 days." };
  return { invoker, target };
}

async function proposeMute(message, intent) {
  const { guild } = message;
  const say = (description, color = colors.error) =>
    message.reply({ embeds: [response({ client: message.client, description, color })], allowedMentions: NO_PINGS }).catch(() => {});

  const kind = REQUIRED_PERM[intent.kind] ? intent.kind : 'mute';
  if (intent.targetIds.length > 1) return say(`one person at a time. tell me who to ${kind}.`);
  if (hasPending(guild.id, message.author.id)) return say('you already have one waiting. confirm or cancel it first.', colors.muted);

  let targetId = intent.targetIds[0];
  if (!targetId) {
    const found = await resolveName(guild, intent.targetName);
    if (found.error) return say(found.error);
    targetId = found.id;
  }

  const ms = kind === 'mute' ? parse(intent.duration) : 0;
  const v = await validateMute(guild, message.author.id, targetId, ms, kind);
  if (v.error) return say(v.error);

  // Limits count only cards that actually get posted (a refused or mistyped request costs nothing).
  // User limit first, so one person hammering this cannot use up the whole server's allowance.
  if (!userRateOk(guild.id, message.author.id)) return say('slow down a bit. try again in a few minutes.', colors.muted);
  if (!rateOk(guild.id)) return say(`a lot of ai actions in a short time. use \`/${kind}\` for now.`);

  const id = crypto.randomUUID();
  const dur = kind === 'mute' ? format(ms) : null;
  const label = kind.charAt(0).toUpperCase() + kind.slice(1);
  const style = kind === 'unmute' ? ButtonStyle.Success : kind === 'warn' ? ButtonStyle.Primary : ButtonStyle.Danger;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`aiact:${id}:ok`).setLabel(label).setStyle(style),
    new ButtonBuilder().setCustomId(`aiact:${id}:no`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  const who = `**${v.target.user.tag}** (\`${v.target.id}\`)`;
  const what = kind === 'mute' ? `mute ${who} for **${dur}**?` : `${kind} ${who}?`;
  const card = await message.reply({
    embeds: [response({
      client: message.client,
      description: `${what}\nreason: ${intent.reason}\n\nonly <@${message.author.id}> can confirm. expires in 2 min.`,
      color: colors.primary,
    })],
    components: [row],
    allowedMentions: NO_PINGS,
  }).catch(() => null);
  if (!card) return;

  const auditId = audit.record({
    guildId: guild.id, invokerId: message.author.id, targetId: v.target.id, kind,
    reason: intent.reason, durationMs: kind === 'mute' ? ms : null, prompt: message.content,
  });

  const timer = setTimeout(() => {
    if (!pending.delete(id)) return;
    audit.resolve(auditId, 'expired');
    card.edit({ embeds: [response({ client: message.client, description: 'expired. nothing was done.', color: colors.muted })], components: [] }).catch(() => {});
  }, PENDING_TTL_MS);
  timer.unref();

  pending.set(id, {
    auditId,
    kind,
    guildId: guild.id,
    invokerId: message.author.id,
    targetId: v.target.id,
    ms,
    dur,
    reason: intent.reason,
    prompt: message.content.slice(0, 300),
    timer,
  });
  log.info(`AI action proposed: ${kind} target=${v.target.id} dur=${dur} by=${message.author.id} guild=${guild.id}`);
}

async function handleButton(interaction) {
  const [, id, verb] = interaction.customId.split(':');
  const ephemeral = (description, color = colors.muted) =>
    interaction.reply({ embeds: [response({ client: interaction.client, description, color })], ephemeral: true }).catch(() => {});

  const p = pending.get(id);
  if (!p) {
    // expired, or the bot restarted since the card was posted (pending actions live in memory, which fails safe).
    // Fix the card itself so it stops offering buttons that do nothing.
    return interaction.update({ embeds: [response({ client: interaction.client, description: 'expired. nothing was done. ask again if you still want it.', color: colors.muted })], components: [] })
      .catch(() => ephemeral('that one expired.'));
  }
  if (interaction.user.id !== p.invokerId) return ephemeral(`only <@${p.invokerId}> can confirm this.`, colors.error);

  // delete before executing so a double click can never run it twice
  pending.delete(id);
  clearTimeout(p.timer);

  if (verb === 'no') {
    audit.resolve(p.auditId, 'cancelled');
    return interaction.update({ embeds: [response({ client: interaction.client, description: 'cancelled.', color: colors.muted })], components: [] }).catch(() => {});
  }

  const { guild } = interaction;
  const v = await validateMute(guild, p.invokerId, p.targetId, p.ms, p.kind);
  if (v.error) {
    audit.resolve(p.auditId, 'rejected', v.error);
    return interaction.update({ embeds: [response({ client: interaction.client, description: `not done: ${v.error}`, color: colors.error })], components: [] }).catch(() => {});
  }

  const reason = `${p.reason} (via Sonder AI, confirmed by ${interaction.user.tag})`;
  const dm = (action, color, extra = {}) =>
    v.target.user.send({ embeds: [dmNotice({ guild, action, reason: p.reason, color, ...extra })] }).catch(() => {});
  let extra;
  let duration;
  try {
    if (p.kind === 'unmute') {
      await dm('unmuted', colors.success);
      await v.target.timeout(null, reason.slice(0, 512));
    } else if (p.kind === 'warn') {
      store.addWarning(guild.id, v.target.id, { reason: `${p.reason} (via Sonder AI)`, moderator: p.invokerId });
      const total = store.getWarnings(guild.id, v.target.id).length;
      extra = `Warning #${total}`;
      await dm('warned', colors.warning);
    } else if (p.kind === 'kick') {
      await dm('kicked', colors.warning); // before the kick, while a DM can still be delivered
      await v.target.kick(reason.slice(0, 512));
    } else {
      await dm('muted', colors.warning, { duration: p.dur });
      await v.target.timeout(p.ms, reason.slice(0, 512));
      duration = p.dur;
    }
    const color = p.kind === 'unmute' ? colors.success : colors.warning;
    await interaction.update({
      embeds: [modAction({ client: interaction.client, action: p.kind, color, target: v.target.user, moderator: interaction.user, reason, duration, extra })],
      components: [],
    });
    await modlog.send(guild, { action: p.kind, target: v.target.user, moderator: interaction.user, reason, duration, extra });
    audit.resolve(p.auditId, 'executed');
    log.info(`AI action executed: ${p.kind} target=${p.targetId} dur=${p.dur} by=${p.invokerId} guild=${guild.id} prompt=${JSON.stringify(p.prompt)}`);
  } catch (err) {
    audit.resolve(p.auditId, 'failed', err.message);
    log.warn(`AI ${p.kind} failed: ${err.message}`);
    interaction.update({ embeds: [response({ client: interaction.client, description: `couldn't ${p.kind} them. check my permissions.`, color: colors.error })], components: [] }).catch(() => {});
  }
}

module.exports = { parseMuteIntent, proposeMute, handleButton, usageHint, _limits: { windowOk, USER_RATE_MAX, RATE_MAX } };
