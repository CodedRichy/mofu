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
const { base, modAction, dmNotice, response } = require('../utils/embed');
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
const NAME_STOP = new Set(['someone', 'somebody', 'anyone', 'everyone', 'everybody', 'people', 'user', 'users', 'member', 'members', 'him', 'her', 'them', 'his', 'hers', 'this', 'that', 'these', 'those', 'guy', 'girl', 'person', 'me', 'myself', 'you', 'yourself', 'it', 'the', 'and', 'for', 'now', 'please', 'pls', 'again', 'later', 'how', 'what', 'why', 'when', 'who', 'can', 'could', 'should', 'would', 'does', 'did', 'command', 'commands', 'works', 'work', 'mean', 'means', 'role', 'roles', 'feature', 'off', 'out', 'back', 'around', 'down', 'up',
  // pronouns, determiners, auxiliaries and prepositions: never a username in "mute <word>"
  'your', 'yours', 'my', 'mine', 'our', 'ours', 'their', 'theirs', 'its', 'whoever', 'whatever', 'whomever', 'all', 'both', 'each', 'every', 'none', 'nobody', 'here', 'there', 'is', 'was', 'are', 'were', 'be', 'been', 'being', 'am', 'will', 'shall', 'may', 'might', 'must', 'not', 'no', 'dont', 'do', 'to', 'of', 'in', 'on', 'at', 'by', 'with', 'from', 'about', 'if', 'then', 'so', 'but', 'or', 'as', 'too', 'very', 'just', 'also',
  // words that follow a verb in ordinary chat ("the mute button", "my timeout ends soon", "warn level high today")
  'button', 'buttons', 'mic', 'ends', 'end', 'level', 'high', 'low', 'today', 'tomorrow', 'yesterday', 'tonight', 'soon', 'time', 'times', 'position', 'ass', 'asses', 'butt', 'rocks', 'rock', 'bucket', 'habit', 'tires', 'tire', 'chat', 'channel', 'server', 'bot', 'sonder', 'music', 'sound', 'volume', 'game', 'stream', 'event', 'gently', 'softly', 'slowly', 'quickly', 'harder', 'hard', 'already', 'forever', 'permanently', 'temporarily',
  // filler, laughter and address terms
  'lol', 'lmao', 'lmfao', 'rofl', 'omg', 'idk', 'ok', 'okay', 'kk', 'plz', 'pleas', 'bro', 'bruh', 'dude', 'fam', 'man', 'guys', 'gang', 'yo', 'hey', 'hi', 'hello', 'xd', 'haha', 'hehe', 'nvm', 'tho', 'though', 'bhai', 'yaar', 'yar',
  // Hinglish / French / Spanish particles that follow a borrowed English verb
  'karo', 'kar', 'kr', 'kro', 'kardo', 'karna', 'karde', 'mat', 'nahi', 'nhi', 'na', 'ko', 'ka', 'ki', 'ke', 'se', 'pe', 'isko', 'usko', 'inko', 'unko', 'pas', 'les', 'tu', 'peux', 'por', 'para', 'con', 'una', 'los']);
// Typed names must look like a username: no channel marks, and not an adverb ("kick gently").
const looksLikeName = (n) => /^[\p{L}\p{N}_.-]+$/u.test(n) && !/^\d/.test(n) && !/^(?:l+o+l+|lm+a+o+|(?:ha){2,}h?|(?:he){2,}h?|x+d+|a+h+|o+h+|u+m+|h+m+|e+h+|y+e+s+|n+o+p?e?)$/i.test(n);

// ---- is this message addressed to the bot as an imperative? ----
// Everything between the bot's name and the verb must be polite filler ("yo sonder, can you please mute ...").
// Anything else ("i will kick", "dont mute", "why did you kick", "he said mute", "the sonder mute button") is
// conversation, not a request.
const PREFIX_FILLER = /^(?:(?:hey|yo|hi|hello|hiya|ok|okay|so|and|then|just|kindly|quickly|now|please|pls|plz|bot|sonder|ya|go ahead and|(?:can|could|would|will)\s+(?:you|u|ya)|you\s+(?:can|could|may)|(?:i\s+)?(?:want|need|wanna|would like|id like)\s+(?:you\s+)?to)(?:\s+|$))+/;
// first word after the verb that makes it a noun / statement ("mute button", "mute is cringe", "kick your ass")
const FOLLOW_BLOCK = new Set(['your', 'yours', 'my', 'his', 'her', 'their', 'our', 'its', 'is', 'was', 'are', 'were', 'be', 'been', 'being', 'button', 'buttons', 'mic', 'the', 'a', 'an', 'to', 'of', 'in', 'on', 'at', 'with', 'if', 'but', 'because', 'when', 'how', 'why', 'what', 'who', 'not', 'dont', 'never']);
const MAX_CONTENT = 4000;

function inCommandPosition(content, botId, verbAt, verbLen) {
  let before = content.slice(0, verbAt);
  if (botId) before = before.replace(new RegExp(`<@!?${botId}>`, 'g'), ' sonder ');
  before = before.replace(/<@!?\d+>/g, ' @m ').toLowerCase();
  // only what follows the bot's name counts: "lol sonder, mute x" is fine, "the sonder mute button" is judged by what follows the verb
  const named = before.lastIndexOf('sonder');
  // "@someone sonder mute @x": the line is addressed to someone else
  if (named >= 0 && /@m[\s,:]*$/.test(before.slice(0, named))) return false;
  if (named >= 0) before = before.slice(named + 'sonder'.length);
  before = before.replace(/[^a-z0-9@'\s]/g, ' ').replace(/'/g, '').replace(/\s+/g, ' ').trim();
  if (before) {
    // a mention before the verb is only OK as "sonder @user mute" (named, exactly one)
    let rest = before;
    for (let prev = null; prev !== rest;) { prev = rest; rest = rest.replace(PREFIX_FILLER, '').trim(); }
    if (named >= 0 && rest === '@m') rest = '';
    if (rest) return false;
  }
  const after = content.slice(verbAt + verbLen).trimStart();
  const next = after.match(/^@?([^\s<>,.!?;:]+)/);
  if (next && FOLLOW_BLOCK.has(next[1].toLowerCase().replace(/'/g, ''))) return false;
  return true;
}

/**
 * Returns null when the message is not a mute request (so it falls through to normal chat),
 * otherwise { kind: 'mute', targetIds, duration, reason }.
 * A request needs the verb AND at least one explicit @mention of someone other than the bot,
 * and must not be phrased as a question.
 */
function parseMuteIntent(content, botId) {
  if (typeof content !== 'string' || content.length > MAX_CONTENT) return null;
  if (/\?\s*$/.test(content.trim())) return null;
  // Several verbs in one message ("kick him, he should have been muted"): act on whichever comes first,
  // and never more than one action per message.
  const hits = [];
  for (const [kind, re] of [['unmute', UNMUTE_VERB], ['warn', WARN_VERB], ['kick', KICK_VERB], ['mute', MUTE_VERB]]) {
    const m = re.exec(content);
    if (m) hits.push([kind, m.index, m[0].length]);
  }
  if (!hits.length) return null;
  hits.sort((a, b) => a[1] - b[1]);
  if (!inCommandPosition(content, botId, hits[0][1], hits[0][2])) return null;
  if (hits[0][0] !== 'mute') return parseSimple(hits[0][0], content, botId);

  const targetIds = [...new Set([...content.matchAll(/<@!?(\d+)>/g)].map((m) => m[1]))].filter((id) => id !== botId);

  let text = content.replace(/<@!?\d+>/g, ' ');
  // No @mention: accept a typed name right after the verb ("mute kai 30s"). It is only a lookup key;
  // proposeMute resolves it to a real member and the confirmation card names who was found.
  let targetName = null;
  if (targetIds.length === 0) {
    const nm = text.match(/\b(?:mute|timeout|time\s*out|silence|shush)\s+@?([^\s<>@,.!?]{3,32})/i);
    if (!nm || !looksLikeName(nm[1]) || NAME_STOP.has(nm[1].toLowerCase())) return null;
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
    if (!nm || !looksLikeName(nm[1]) || NAME_STOP.has(nm[1].toLowerCase())) return null;
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
  if (words.length === 1) return HINTS[words[0]] || null;
  // the hint text itself says "@someone": people paste it back verbatim, so answer that with the hint again
  if (words.length >= 2 && words[1] === 'someone' && HINTS[words[0]]) return HINTS[words[0]];
  return null;
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

// ---- presentation only: proposal card + compact result cards ----
const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 3)}...` : t; };
const unix = (ms) => Math.floor(ms / 1000);

// The slash-equivalent of what will run, shown in a code block (no mentions inside, so nothing can ping).
function commandText(kind, target, dur, reason) {
  const name = clip(target.user?.username || target.displayName || target.id, 32).replace(/`/g, "'");
  const r = clip(reason, 80).replace(/`/g, "'").replace(/\s+/g, ' ');
  const parts = [`/${kind}`, `@${name}`];
  if (kind === 'mute' && dur) parts.push(dur);
  if (kind !== 'unmute' && r) parts.push(r);
  return clip(parts.join(' '), 200);
}

function proposalCard({ client, kind, target, dur, reason, invokerId, expiresAt }) {
  const need = REQUIRED_PERM[kind];
  const top = target.roles?.highest?.name || '@everyone';
  const safeReason = clip(reason, 200).replace(/@(everyone|here)/gi, '$1');
  return base(client, colors.warning)
    .setAuthor({ name: 'AI ACTION PROPOSAL', iconURL: target.user?.displayAvatarURL?.() || undefined })
    .addFields(
      { name: 'Command', value: `\`\`\`\n${commandText(kind, target, dur, reason)}\n\`\`\``.slice(0, 1024) },
      { name: 'Reason', value: clip(safeReason, 200) || 'No reason provided' },
      { name: 'Target', value: clip(`<@${target.id}> - ${top}`, 1024), inline: true },
      { name: 'Who can confirm', value: clip(`Only <@${invokerId}> (needs ${need.label})`, 1024), inline: true },
      { name: 'Expires', value: `<t:${unix(expiresAt)}:R>`, inline: true },
    );
}

// Compact result card: action, target, duration, "via Sonder AI".
function resultCard({ client, title, kind, targetId, dur, note, color }) {
  const lines = [`**Action** ${kind}`];
  if (targetId) lines.push(`**Target** <@${targetId}>`);
  if (dur) lines.push(`**Duration** ${dur}`);
  if (note) lines.push(clip(note, 300));
  return base(client, color)
    .setAuthor({ name: title })
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'via Sonder AI', iconURL: client?.user?.displayAvatarURL?.() || undefined });
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
  const expiresAt = Date.now() + PENDING_TTL_MS;
  const card = await message.reply({
    embeds: [proposalCard({
      client: message.client, kind, target: v.target, dur, reason: intent.reason,
      invokerId: message.author.id, expiresAt,
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
    card.edit({ embeds: [resultCard({ client: message.client, title: 'EXPIRED', kind, targetId: v.target.id, dur, note: 'Nothing was done.', color: colors.muted })], components: [], allowedMentions: NO_PINGS }).catch(() => {});
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
    return interaction.update({ embeds: [resultCard({ client: interaction.client, title: 'EXPIRED', kind: 'action', note: 'Nothing was done. Ask again if you still want it.', color: colors.muted })], components: [], allowedMentions: NO_PINGS })
      .catch(() => ephemeral('that one expired.'));
  }
  if (interaction.user.id !== p.invokerId) return ephemeral(`only <@${p.invokerId}> can confirm this.`, colors.error);

  // delete before executing so a double click can never run it twice
  pending.delete(id);
  clearTimeout(p.timer);

  if (verb === 'no') {
    audit.resolve(p.auditId, 'cancelled');
    return interaction.update({ embeds: [resultCard({ client: interaction.client, title: 'CANCELLED', kind: p.kind, targetId: p.targetId, dur: p.dur, note: 'Nothing was done.', color: colors.muted })], components: [], allowedMentions: NO_PINGS }).catch(() => {});
  }

  const { guild } = interaction;

  // Acknowledge now: the fetches below and the DM/API calls after them can run past Discord's 3s window, and an
  // expired interaction (10062) would otherwise turn a successful action into a false 'failed' audit row.
  // Nothing has been done yet, so if even this fails we stop and record that.
  try {
    await interaction.deferUpdate();
  } catch (err) {
    audit.resolve(p.auditId, 'failed', `interaction expired before it could be acknowledged: ${err.message}`);
    log.warn(`AI ${p.kind} not run, could not acknowledge the button: ${err.message}`);
    return;
  }
  // editReply after deferUpdate edits the card; a failed edit must never change the outcome of the action itself.
  const show = (payload) => interaction.editReply({ components: [], allowedMentions: NO_PINGS, ...payload }).catch(() => {});

  const v = await validateMute(guild, p.invokerId, p.targetId, p.ms, p.kind);
  if (v.error) {
    audit.resolve(p.auditId, 'rejected', v.error);
    return show({ embeds: [resultCard({ client: interaction.client, title: 'NOT DONE', kind: p.kind, targetId: p.targetId, dur: p.dur, note: v.error, color: colors.error })] });
  }

  const reason = `${p.reason} (via Sonder AI, confirmed by ${interaction.user.tag})`;
  const dm = (action, color, extra = {}) =>
    v.target.user.send({ embeds: [dmNotice({ guild, action, reason: p.reason, color, ...extra })] }).catch(() => {});
  let extra;
  let duration;
  try {
    if (p.kind === 'unmute') {
      await v.target.timeout(null, reason.slice(0, 512));
      await dm('unmuted', colors.success); // only after it worked
    } else if (p.kind === 'warn') {
      store.addWarning(guild.id, v.target.id, { reason: `${p.reason} (via Sonder AI)`, moderator: p.invokerId });
      const total = store.getWarnings(guild.id, v.target.id).length;
      extra = `Warning #${total}`;
      await dm('warned', colors.warning);
    } else if (p.kind === 'kick') {
      // A kicked member shares no server with the bot afterwards, so this DM can only go first. Every check passed.
      await dm('kicked', colors.warning);
      await v.target.kick(reason.slice(0, 512));
    } else {
      await v.target.timeout(p.ms, reason.slice(0, 512));
      await dm('muted', colors.warning, { duration: p.dur }); // only after it worked
      duration = p.dur;
    }
  } catch (err) {
    audit.resolve(p.auditId, 'failed', err.message);
    log.warn(`AI ${p.kind} failed: ${err.message}`);
    return show({ embeds: [resultCard({ client: interaction.client, title: 'FAILED', kind: p.kind, targetId: p.targetId, dur: p.dur, note: "Couldn't do that. Check my permissions.", color: colors.error })] });
  }

  // The action happened. Record that first; the card and modlog are presentation.
  audit.resolve(p.auditId, 'executed');
  log.info(`AI action executed: ${p.kind} target=${p.targetId} dur=${p.dur} by=${p.invokerId} guild=${guild.id} prompt=${JSON.stringify(p.prompt)}`);
  const color = p.kind === 'unmute' ? colors.success : colors.warning;
  await show({ embeds: [modAction({ client: interaction.client, action: p.kind, color, target: v.target.user, moderator: interaction.user, reason: clip(reason, 512), duration, extra })] });
  await modlog.send(guild, { action: p.kind, target: v.target.user, moderator: interaction.user, reason: clip(reason, 512), duration, extra }).catch(() => {});
}

module.exports = { parseMuteIntent, proposeMute, handleButton, usageHint, _limits: { windowOk, USER_RATE_MAX, RATE_MAX } };
