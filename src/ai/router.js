// Natural-language command router: "mofu what's my balance", "mofu give riri 100 coins", "mofu ban @x spam".
//
// The model never decides what runs; it asks before it acts:
//  - The model only PROPOSES. It sees a short list of real commands (a keyword shortlist of the closed registry
//    built from client.commands) and must answer strict JSON {command, args} or {none:true}. Anything else
//    (unparseable, a command it was not offered, extra fields, bad args) is no action: the message falls
//    through to normal chat.
//  - Code checks every argument: users, roles and channels must be mentioned in the message or found by name;
//    a model-made id is never trusted.
//  - Execution is the prefix path: message.content becomes `${prefix}${command} ${args}` and the normal command
//    code runs it, so PrefixContext validation, cooldowns and default_member_permissions all still apply.
//    execute() is never called from here.
//  - RISK TIERS (one table below). RUN_NOW commands run straight away. Everything else, including any command
//    that needs a permission and any command not listed (new commands default here), gets a confirm card that
//    only the requester can press, which expires, and which re-checks real permissions and role order on press.
//  - BLOCKED commands never route from chat; the person gets a short "use <command> for that" reply.
const crypto = require('crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ApplicationCommandOptionType: T } = require('discord.js');
const { colors, BRAND, TRIGGER_WORDS } = require('../utils/constants');
const { base, response } = require('../utils/embed');
const { cmdRef } = require('../utils/invocation');
const log = require('../utils/logger');
const { shared } = require('./actions');

const { pending, hasPending, userRateOk, rateOk, resolveName, looksLikeName, NAME_STOP, NO_PINGS, resultCard, audit } = shared;

const CONFIRM_TTL_MS = 60000;
const ROUTER_COOLDOWN_MS = 4000; // same as the chat cooldown in messageCreate.js
const SHORTLIST_SIZE = 12;
const MAX_ARG_LEN = 300;

// ---------------------------------------------------------------------------------------------------------
// RISK TIER TABLE. Keys are a command name (all its subcommands) or "command subcommand".
// RUN_NOW: read-only, or only changes the requester's own things (their reminders, afk, timezone, wallet <->
// bank). Anything that needs a permission is confirmed even if listed here (see tierOf).
// BLOCKED: never routed from chat (destructive, secret-bearing, safety settings, or would break anonymity).
// Everything else: CONFIRM.
// ---------------------------------------------------------------------------------------------------------
const RUN_NOW = new Set([
  // ai
  'vibe', 'roast', 'persona',
  // economy (own wallet only; gambling, buying, robbing and transfers are confirmed)
  'bank balance', 'bank deposit', 'bank withdraw', 'beg', 'daily', 'fish', 'hunt', 'work', 'inventory', 'leaderboard', 'shop view',
  // fun
  '8ball', 'bite', 'blacktea', 'bonk', 'cat', 'dog', 'hug', 'kiss', 'meme', 'mock', 'pat', 'rps', 'ship', 'slap', 'trivia', 'truthordare', 'uwuify', 'wyr',
  // lastfm (fm set only links the requester's own username)
  'fm',
  // leveling
  'rank', 'xpleaderboard',
  // music (same as the existing "mofu play/skip ..." sentences, which already run straight away)
  'loop', 'lyrics', 'nowplaying', 'pause', 'play', 'queue', 'resume', 'shuffle', 'skip', 'stop', 'volume',
  // utility
  'afk', 'avatar', 'banner', 'besttime', 'boostimpact', 'botinfo', 'bots', 'calculate', 'catchup', 'channelstats', 'define',
  'emoji list', 'emoji stats', 'emoji enlarge', 'firstmessage', 'github', 'help', 'inrole',
  'invites link', 'invites check', 'invites leaderboard', 'joinposition', 'membercount', 'milestone', 'newusers', 'ping', 'privacy',
  'quote random', 'quote search', 'quote get', 'remind set', 'remind list', 'remind cancel', 'roleinfo', 'server', 'spotlight',
  'tag use', 'tag info', 'tag list', 'timezone', 'toprole', 'translate', 'uptime', 'userinfo', 'voice info',
  'birthday set', 'birthday remove', 'birthday list', 'birthday view',
]);

const BLOCKED = new Set([
  'backup', 'import', 'forgetme', 'migrate', // destructive / restores / deletes data
  'antinuke', 'antiraid', 'setup', 'quicksetup', 'aiactions', 'airoles', // safety settings and AI access
  'memory', // facts the AI is told: never written by the AI path
  'confess', // anonymous: posting it from a chat message would show who sent it
]);

// Not offered and no reply: plain chat already covers them.
const SILENT = new Set(['ask']);

function tierOf(entry) {
  if (!entry || BLOCKED.has(entry.name)) return 'blocked';
  if (entry.perm) return 'confirm';
  if (RUN_NOW.has(entry.key) || RUN_NOW.has(entry.name)) return 'run';
  return 'confirm';
}

// ---- registry: one entry per command or subcommand, built once per command collection ----
// Extra words people use for a command (English, Hinglish, slang). Weighted like the command's own name.
const SYNONYMS = {
  'bank balance': ['balance', 'bal', 'money', 'coins', 'coin', 'cash', 'wallet', 'paise', 'paisa', 'paisay', 'networth'],
  'bank deposit': ['deposit', 'dep'],
  'bank withdraw': ['withdraw', 'wd'],
  transfer: ['give', 'send', 'pay', 'donate', 'coins', 'money', 'paise'],
  rank: ['level', 'lvl', 'xp', 'levels'],
  xpleaderboard: ['xp', 'levels'],
  leaderboard: ['richest', 'top'],
  'remind set': ['remind', 'reminder', 'remember', 'yaad', 'alarm'],
  'remind list': ['reminders'],
  mute: ['timeout', 'silence', 'shush'],
  purge: ['clear', 'delete', 'clean', 'prune'],
  avatar: ['pfp', 'pic', 'dp'],
  userinfo: ['whois', 'info'],
  server: ['serverinfo'],
  coinflip: ['flip', 'toss', 'heads', 'tails'],
  timezone: ['tz', 'time'],
  forgetme: ['forget', 'erase'],
  play: ['song', 'music', 'bajao', 'chalao'],
  skip: ['next'],
  nowplaying: ['playing', 'np'],
  setlevel: ['level'],
  calculate: ['calc', 'math', 'solve'],
  translate: ['translation'],
  ping: ['latency', 'lag'],
  slowmode: ['slow'],
  lock: ['unlock'],
  role: ['give role'],
};

const STOP = new Set([...TRIGGER_WORDS, 'a', 'an', 'the', 'me', 'my', 'mine', 'i', 'im', 'you', 'u', 'ur', 'your', 'to', 'of', 'for', 'in', 'on', 'at', 'is', 'are', 'was', 'be',
  'what', 'whats', 'how', 'hows', 'who', 'show', 'tell', 'please', 'pls', 'plz', 'can', 'could', 'would', 'will', 'hey', 'yo', 'hi', 'bro', 'and', 'or', 'it', 'its',
  'this', 'that', 'do', 'does', 'did', 'with', 'from', 'by', 'as', 'all', 'any', 'some', 'now', 'just', 'one', 'get', 'set', 'add', 'make',
  'mera', 'meri', 'mere', 'mujhe', 'muje', 'dikhao', 'batao', 'kya', 'hai', 'ka', 'ki', 'ke', 'kar', 'karo', 'kr', 'de', 'do', 'dena', 'ko', 'se', 'yaar', 'bhai']);

const tokenize = (s) => String(s || '').toLowerCase()
  .replace(/<a?:\w+:\d+>|<@[!&]?\d+>|<#\d+>/g, ' ')
  .replace(/(.)\1{2,}/g, '$1') // stretched letters: "balanceee" -> "balance"
  .split(/[^\p{L}\p{N}]+/u)
  .filter((w) => w && !STOP.has(w));

// optimal string alignment distance <= 1 (one typo: substitution, insert, delete, or swapped pair)
function oneTypo(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  return s.slice(i) === l.slice(i + 1);
}

const TYPE_NAME = { [T.String]: 'text', [T.Integer]: 'int', [T.Number]: 'number', [T.Boolean]: 'yes/no', [T.User]: 'user', [T.Channel]: 'channel', [T.Role]: 'role', [T.Attachment]: 'file' };

function optionText(o) {
  const choices = o.choices?.length ? `[${o.choices.map((c) => c.value).join('|')}]` : '';
  return `${o.name}${o.required ? '' : '?'}:${choices || TYPE_NAME[o.type] || 'text'}`;
}

const registryCache = new WeakMap();

function buildRegistry(commands, aliases = null) {
  if (commands && registryCache.has(commands)) return registryCache.get(commands);
  const aliasOf = new Map(); // command name -> [aliases]
  if (aliases) for (const [alias, cmd] of aliases) {
    const n = cmd?.data?.name;
    if (n) aliasOf.set(n, [...(aliasOf.get(n) || []), alias]);
  }
  const entries = [];
  for (const cmd of commands.values()) {
    let json;
    try { json = cmd.data.toJSON(); } catch { continue; }
    const perm = json.default_member_permissions || null;
    const top = json.options || [];
    const subs = top.length && top[0].type === T.Subcommand ? top.filter((o) => o.type === T.Subcommand) : null;
    const make = (sub, options, description) => {
      const key = sub ? `${json.name} ${sub}` : json.name;
      const words = new Map();
      const put = (w, n) => { for (const t of tokenize(w)) words.set(t, Math.max(words.get(t) || 0, n)); };
      put(json.name.replace(/[_-]/g, ' '), 5);
      words.set(json.name, 5);
      for (const a of aliasOf.get(json.name) || []) if (a.length > 1) words.set(a, 5);
      for (const k of [json.name, key]) for (const s of SYNONYMS[k] || []) put(s, 5);
      if (sub) put(sub, 2);
      put(description, 1);
      for (const o of options) { put(o.name.replace(/_/g, ' '), 1); for (const c of o.choices || []) put(String(c.name), 2); }
      const line = `${key} | ${String(description || '').slice(0, 70)} | ${options.map(optionText).join(' ') || '-'}`;
      entries.push({ key, name: json.name, sub, perm, options, line, words, hasFile: options.some((o) => o.type === T.Attachment) });
    };
    if (subs) for (const s of subs) make(s.name, s.options || [], s.description || json.description);
    else make(null, top, json.description);
  }
  const reg = { entries, byKey: new Map(entries.map((e) => [e.key, e])) };
  if (commands) registryCache.set(commands, reg);
  return reg;
}

// Score every entry by word overlap with the sentence. strong = the command's own name, an alias or a synonym
// (exact or one typo). A 4+ letter piece of a compound name ("coin" in coinflip) helps ranking but is not
// strong on its own ("good morning" must not wake the model for goodbye).
function score(entry, tokens) {
  let total = 0;
  let strong = false;
  for (const t of tokens) {
    let best = entry.words.get(t) || 0;
    if (best < 5 && t.length >= 4) {
      for (const [w, n] of entry.words) if (n === 5 && w.length >= 4 && oneTypo(t, w)) { best = 4; break; }
    }
    if (best < 3 && t.length >= 4 && entry.name.length > t.length && entry.name.includes(t)) best = 3; // a piece of a compound name: ranks, not strong
    if (best >= 4) strong = true;
    total += best;
  }
  return { total, strong };
}

function shortlist(sentence, registry, n = SHORTLIST_SIZE) {
  const tokens = [...new Set(tokenize(sentence))];
  if (!tokens.length) return [];
  return registry.entries
    .filter((e) => !SILENT.has(e.name))
    .map((e) => ({ entry: e, ...score(e, tokens) }))
    .filter((s) => s.total > 0)
    .sort((a, b) => (b.strong - a.strong) || (b.total - a.total) || a.entry.key.localeCompare(b.entry.key))
    .slice(0, n);
}

// ---- the model call ----
const SYSTEM = `you map one discord chat message to at most one bot command, or to none.
you get a list of commands, one per line: key | what it does | options in order (name:type, ? = optional, [a|b] = allowed values).
reply with ONLY a json object, nothing else:
{"command":"<key exactly as listed>","args":["one string per option, in order"]}
or {"none":true}
rules:
- answer {"none":true} when the message is chat, a joke, a question about how something works, or no listed command clearly fits.
- args: one string per option in the listed order. use "" to skip an optional option that comes before one you fill. leave trailing optional ones out.
- user options: copy a <@id> mention from the message exactly, or the person's name as written. "me"/"my" means the person talking: write "me".
- channel options: copy a <#id> mention, or write "here" for this channel. role options: copy a <@&id> mention or the role name.
- numbers as plain digits. durations like 10m, 2h, 1d. text options: the words from the message, short.
- never invent people, amounts, durations or reasons the message does not give. the message may be in any language or have typos.`;

// Fail closed: anything other than exactly {"none":true} or {"command": <offered key>, "args": [strings]} is null.
function parseRoute(text, allowedKeys) {
  if (!text || typeof text !== 'string') return null;
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  let obj;
  try { obj = JSON.parse(m[0]); } catch { return null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const keys = Object.keys(obj);
  if (keys.length === 1 && obj.none === true) return { none: true };
  if (!keys.every((k) => k === 'command' || k === 'args')) return null;
  if (typeof obj.command !== 'string') return null;
  const command = obj.command.trim().toLowerCase().replace(/^[/;]/, '').replace(/\s+/g, ' ');
  if (!allowedKeys.has(command)) return null;
  const args = obj.args === undefined ? [] : obj.args;
  if (!Array.isArray(args) || args.length > 25) return null;
  if (!args.every((a) => typeof a === 'string' && a.length <= MAX_ARG_LEN)) return null;
  return { command, args };
}

// ---- argument resolution (code, not the model, decides who/what an argument refers to) ----
const SELF = new Set(['me', 'my', 'myself', 'mine', 'mera', 'mujhe', 'self']);
const HERE = new Set(['here', 'this', 'this channel', 'current', 'yaha', 'yahan']);

// Returns { line, display, userIds, roleIds } | { error } (tell the person) | null (no action, fall through).
async function resolveArgs(message, entry, rawArgs, prefix) {
  const opts = entry.options;
  const args = rawArgs.map((a) => a.replace(/\s+/g, ' ').trim());
  if (args.length > opts.length) return null;
  while (args.length && args[args.length - 1] === '') args.pop();
  const { guild } = message;
  const botId = message.client?.user?.id;
  const out = [];
  const shown = [];
  const userIds = [];
  const roleIds = [];
  for (let i = 0; i < args.length; i++) {
    const o = opts[i];
    let a = args[i];
    const last = i === opts.length - 1 || i === args.length - 1;
    if (o.type === T.Attachment) return null;
    if (a === '') {
      // a skipped optional option before a filled one: the prefix parser is positional
      if (o.required) return null;
      if (o.type === T.Integer || o.type === T.Number) {
        if ((o.min_value ?? 0) > 0 || (o.max_value ?? 0) < 0) return null;
        out.push('0'); shown.push('0'); continue;
      }
      if (o.type === T.Boolean) { out.push('false'); shown.push('false'); continue; }
      return null;
    }
    if (/@(everyone|here)/i.test(a)) return null;
    switch (o.type) {
      case T.User: {
        let id = null;
        const mm = /^<@!?(\d{17,20})>$/.exec(a);
        if (mm) {
          if (!message.mentions?.users?.has(mm[1]) || mm[1] === botId) return null;
          id = mm[1];
        } else if (/^\d{17,20}$/.test(a)) {
          if (!message.content.includes(a)) return null; // an id the model made up
          id = a;
        } else {
          const name = a.replace(/^@/, '');
          if (SELF.has(name.toLowerCase())) id = message.author.id;
          else {
            if (!looksLikeName(name) || NAME_STOP.has(name.toLowerCase())) return null;
            const found = await resolveName(guild, name);
            if (found.error) return { error: found.error };
            id = found.id;
          }
        }
        userIds.push(id);
        out.push(`<@${id}>`);
        const mem = guild.members.cache.get(id);
        shown.push(`@${mem?.user?.username || mem?.displayName || id}`);
        break;
      }
      case T.Role: {
        let role = null;
        const mm = /^<@&(\d{17,20})>$/.exec(a);
        if (mm) {
          if (!message.mentions?.roles?.has(mm[1])) return null;
          role = guild.roles.cache.get(mm[1]);
        } else {
          const lower = a.replace(/^@/, '').toLowerCase();
          const hits = guild.roles.cache.filter((r) => r.id !== guild.id && r.name.toLowerCase() === lower);
          if (hits.size > 1) return { error: `more than one role called "${a.slice(0, 40)}". @mention the one you mean.` };
          role = hits.first();
          if (!role) return { error: `couldn't find a role called "${a.slice(0, 40)}".` };
        }
        if (!role) return null;
        roleIds.push(role.id);
        out.push(`<@&${role.id}>`);
        shown.push(`@${role.name}`);
        break;
      }
      case T.Channel: {
        let ch = null;
        const mm = /^<#(\d{17,20})>$/.exec(a);
        if (mm) {
          if (!message.mentions?.channels?.has(mm[1])) return null;
          ch = guild.channels.cache.get(mm[1]);
        } else if (HERE.has(a.toLowerCase())) {
          ch = message.channel;
        } else {
          const lower = a.replace(/^#/, '').toLowerCase();
          ch = guild.channels.cache.find((c) => c.name?.toLowerCase() === lower);
          if (!ch) return { error: `couldn't find a channel called "${a.slice(0, 40)}".` };
        }
        if (!ch) return null;
        out.push(`<#${ch.id}>`);
        shown.push(`#${ch.name}`);
        break;
      }
      case T.Integer:
      case T.Number: {
        let n = a.replace(/,/g, '').toLowerCase();
        if (/^\d+(\.\d+)?k$/.test(n)) n = String(Math.round(parseFloat(n) * 1000));
        if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(n)) return null;
        out.push(n); shown.push(n);
        break;
      }
      case T.Boolean: {
        const v = /^(true|yes|y|on|1|haan|ha)$/i.test(a) ? 'true' : /^(false|no|n|off|0|nahi|nhi)$/i.test(a) ? 'false' : null;
        if (!v) return null;
        out.push(v); shown.push(v);
        break;
      }
      default: {
        // free text: only the last option may hold spaces (the prefix parser gives earlier ones one word)
        if (/\s/.test(a) && !last) return null;
        if (o.choices?.length && !o.choices.some((c) => String(c.value).toLowerCase() === a.toLowerCase() || String(c.name).toLowerCase() === a.toLowerCase())) return null;
        a = a.replace(/`/g, "'");
        out.push(a); shown.push(a);
      }
    }
  }
  const head = `${prefix}${entry.name}${entry.sub ? ` ${entry.sub}` : ''}`;
  const line = [head, ...out].join(' ').trim();
  const display = [head, ...shown].join(' ').trim().slice(0, 300);
  return { line, display, userIds, roleIds };
}

// ---- authority: checked when the card is shown AND again when it is pressed. Fresh fetches every time. ----
async function checkAuthority(message, plan, canInvokeAi) {
  const { guild } = message;
  const invoker = await guild.members.fetch({ user: message.author.id, force: true }).catch(() => null);
  if (!invoker) return "couldn't verify your permissions.";
  if (canInvokeAi && !canInvokeAi(message)) return "you can't ask me to do things from chat in this server any more.";
  if (plan.perm && !invoker.permissions.has(BigInt(plan.perm))) return `you don't have the permission ${cmdRef(guild.id, plan.name)} needs.`;
  if (plan.perm && invoker.id !== guild.ownerId) {
    const mine = invoker.roles.highest.position;
    for (const id of plan.userIds) {
      if (id === invoker.id) continue;
      if (id === guild.ownerId) return "you can't do that to the server owner.";
      const t = await guild.members.fetch(id).catch(() => null);
      if (t && t.roles.highest.position >= mine) return "you can't do that to someone with a higher or equal role.";
    }
    for (const rid of plan.roleIds) {
      const r = guild.roles.cache.get(rid);
      if (r && r.position >= mine) return 'that role is higher than or equal to your highest role.';
    }
  }
  return null;
}

function proposalCard({ client, display, invokerId, expiresAt }) {
  return base(client, colors.warning)
    .setAuthor({ name: 'AI COMMAND PROPOSAL' })
    .addFields(
      { name: 'Command', value: `\`\`\`\n${display.replace(/`/g, "'")}\n\`\`\``.slice(0, 1024) },
      { name: 'Who can confirm', value: `Only <@${invokerId}>`, inline: true },
      { name: 'Expires', value: `<t:${Math.floor(expiresAt / 1000)}:R>`, inline: true },
    )
    .setDescription('Confirm runs this exactly as if you typed it. Your permissions are checked again when you press.');
}

const cooldown = new Map();
setInterval(() => {
  const cutoff = Date.now() - ROUTER_COOLDOWN_MS;
  for (const [k, t] of cooldown) if (t < cutoff) cooldown.delete(k);
}, 60000).unref();

/**
 * Try to turn a message addressed to the bot into one real command.
 * deps: { prefix, runPrefix(message) -> Promise, canInvokeAi(message) -> bool, ask?(messages, opts) -> text }
 * Returns true when it handled the message (ran it, posted a card, or replied), false to fall through to chat.
 */
async function routeMessage(message, deps) {
  const { prefix, runPrefix, canInvokeAi } = deps;
  const ask = deps.ask || ((messages, opts) => require('../utils/ai').chat(messages, opts));
  const { guild } = message;
  if (!guild || !message.client?.commands || typeof message.content !== 'string' || message.content.length > 1500) return false;

  const reg = buildRegistry(message.client.commands, message.client.aliases);
  const botId = message.client.user?.id;
  const sentence = message.content.replace(new RegExp(`<@!?${botId}>`, 'g'), BRAND);
  const list = shortlist(sentence, reg);
  if (!list.length || !list[0].strong) return false; // nothing command-like: plain chat, no model call

  // the clearest match is a command that stays typed: say so instead of guessing at a neighbour
  if (BLOCKED.has(list[0].entry.name) && tokenize(sentence).length <= 6) {
    await message.reply({ embeds: [response({ client: message.client, description: `that one stays typed: use ${cmdRef(guild.id, list[0].entry.name)} for it.`, color: colors.muted })], allowedMentions: NO_PINGS }).catch(() => {});
    return true;
  }

  const ckey = `${guild.id}:${message.author.id}`;
  const now = Date.now();
  if (now - (cooldown.get(ckey) || 0) < ROUTER_COOLDOWN_MS) return false;
  cooldown.set(ckey, now);

  const offered = list.map((s) => s.entry).filter((e) => tierOf(e) !== 'blocked' && !e.hasFile);
  if (!offered.length) return false;
  const allowed = new Set(offered.map((e) => e.key));
  const text = await ask([
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `commands:\n${offered.map((e) => e.line).join('\n')}\n\nmessage from ${message.member?.displayName || message.author.username}: ${sentence.slice(0, 600)}` },
  ], { maxTokens: 200, temperature: 0, guildId: guild.id, kind: 'chat' });
  const route = parseRoute(text, allowed);
  if (!route || route.none) return false; // over budget, model down, junk, or chat: normal chat path

  const entry = reg.byKey.get(route.command);
  const tier = tierOf(entry);
  if (tier === 'blocked') return false;
  const say = (description, color = colors.error) =>
    message.reply({ embeds: [response({ client: message.client, description, color })], allowedMentions: NO_PINGS }).catch(() => {});

  const resolved = await resolveArgs(message, entry, route.args, prefix);
  if (!resolved) return false;
  if (resolved.error) { await say(resolved.error); return true; }

  const plan = { ...resolved, name: entry.name, key: entry.key, perm: entry.perm };
  log.info(`AI route: "${message.content.slice(0, 120)}" -> ${plan.line} (${tier}) by=${message.author.id} guild=${guild.id}`);

  if (tier === 'run') {
    message.content = plan.line;
    await runPrefix(message);
    return true;
  }
  await propose(message, plan, deps);
  return true;
}

async function propose(message, plan, { runPrefix, canInvokeAi }) {
  const { guild } = message;
  const say = (description, color = colors.error) =>
    message.reply({ embeds: [response({ client: message.client, description, color })], allowedMentions: NO_PINGS }).catch(() => {});
  if (hasPending(guild.id, message.author.id)) return say('you already have one waiting. confirm or cancel it first.', colors.muted);
  const denied = await checkAuthority(message, plan, canInvokeAi);
  if (denied) return say(denied);
  if (!userRateOk(guild.id, message.author.id)) return say('slow down a bit. try again in a few minutes.', colors.muted);
  if (!rateOk(guild.id)) return say(`a lot of ai actions in a short time. type ${cmdRef(guild.id, plan.name)} for now.`);

  const id = crypto.randomUUID();
  const expiresAt = Date.now() + CONFIRM_TTL_MS;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`aiact:${id}:ok`).setLabel('Confirm').setStyle(plan.perm ? ButtonStyle.Danger : ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`aiact:${id}:no`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  const card = await message.reply({
    embeds: [proposalCard({ client: message.client, display: plan.display, invokerId: message.author.id, expiresAt })],
    components: [row],
    allowedMentions: NO_PINGS,
  }).catch(() => null);
  if (!card) return;

  const auditId = audit.record({
    guildId: guild.id, invokerId: message.author.id, targetId: plan.userIds[0] || '-', kind: plan.key,
    reason: plan.display, prompt: message.content,
  });
  const timer = setTimeout(() => {
    if (!pending.delete(id)) return;
    audit.resolve(auditId, 'expired');
    card.edit({ embeds: [resultCard({ client: message.client, title: 'EXPIRED', kind: plan.key, note: 'Nothing was done.', color: colors.muted })], components: [], allowedMentions: NO_PINGS }).catch(() => {});
  }, CONFIRM_TTL_MS);
  timer.unref?.();

  pending.set(id, {
    auditId, kind: plan.key, guildId: guild.id, invokerId: message.author.id, targetId: plan.userIds[0] || null, dur: null, timer,
    // runs only after actions.handleButton has checked the presser is the invoker, removed the card and acknowledged it
    onConfirm: async ({ interaction, p, show }) => {
      const no = await checkAuthority(message, plan, canInvokeAi);
      if (no) {
        audit.resolve(p.auditId, 'rejected', no);
        return show({ embeds: [resultCard({ client: interaction.client, title: 'NOT DONE', kind: plan.key, note: no, color: colors.error })] });
      }
      await show({ embeds: [resultCard({ client: interaction.client, title: 'CONFIRMED', kind: plan.key, note: `Running \`${plan.display.replace(/`/g, "'")}\` for ${interaction.user.tag}.`, color: colors.success })] });
      message.content = plan.line;
      try {
        await runPrefix(message);
        audit.resolve(p.auditId, 'executed');
      } catch (err) {
        audit.resolve(p.auditId, 'failed', err.message);
        log.warn(`AI routed ${plan.key} failed: ${err.message}`);
      }
    },
  });
  log.info(`AI command proposed: ${plan.line} by=${message.author.id} guild=${guild.id}`);
}

module.exports = {
  routeMessage, buildRegistry, shortlist, parseRoute, resolveArgs, tierOf, checkAuthority,
  RUN_NOW, BLOCKED, SILENT, SYSTEM, CONFIRM_TTL_MS, _tokenize: tokenize, _oneTypo: oneTypo, _resetCooldown: () => cooldown.clear(),
};
