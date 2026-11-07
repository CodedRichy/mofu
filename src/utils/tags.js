// Tags: per-server saved responses (/tag create rules ..., then /tag use rules or ;tag rules).
// Pure helpers: name rules and variable substitution. Variables are a fixed whitelist replaced in ONE pass by a
// single regex, so text supplied through {args} (or produced by any variable) is never expanded again and
// nothing is ever evaluated.

const LIMITS = { perGuild: 100, nameMax: 32, contentMax: 1900, cooldownMs: 3000, argsMax: 500 };
const NAME_RE = /^[a-z0-9_-]{1,32}$/;
// Subcommand words: `;tag list` must always mean the subcommand, never a tag named "list".
const RESERVED = new Set(['create', 'edit', 'delete', 'list', 'info', 'use', 'manager', 'help']);

function normalizeName(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

// Returns an error string or null. isCommand(name) -> true when a bot command or alias has that name.
function nameError(name, { isCommand = () => false } = {}) {
  if (!name) return 'Give the tag a name.';
  if (name.length > LIMITS.nameMax) return `Tag names are at most ${LIMITS.nameMax} characters.`;
  if (!NAME_RE.test(name)) return 'Tag names may only use a-z, 0-9, `_` and `-` (no spaces).';
  if (RESERVED.has(name)) return `\`${name}\` is a /tag subcommand. Pick another name.`;
  if (isCommand(name)) return `\`${name}\` is already a command. Pick another name so the two never get mixed up.`;
  return null;
}

function contentError(content) {
  const t = String(content ?? '').trim();
  if (!t) return 'Tag content cannot be empty.';
  if (t.length > LIMITS.contentMax) return `Tag content is at most ${LIMITS.contentMax} characters (yours is ${t.length}).`;
  return null;
}

const VAR_RE = /\{(user\.name|user|server|channel|membercount|args|random:[^{}]{1,500})\}/gi;

// ctx: { user: {id, username}, member?: {displayName}, guild: {name, memberCount}, channel?: {id}, args?: string }
function renderTag(content, ctx, rng = Math.random) {
  return String(content).replace(VAR_RE, (_m, v) => {
    const key = v.toLowerCase();
    if (key === 'user') return ctx.user ? `<@${ctx.user.id}>` : '';
    if (key === 'user.name') return ctx.member?.displayName || ctx.user?.globalName || ctx.user?.username || '';
    if (key === 'server') return ctx.guild?.name || '';
    if (key === 'channel') return ctx.channel?.id ? `<#${ctx.channel.id}>` : '';
    if (key === 'membercount') return String(ctx.guild?.memberCount ?? '');
    if (key === 'args') return String(ctx.args ?? '').slice(0, LIMITS.argsMax);
    // random:a|b|c
    const choices = v.slice('random:'.length).split('|');
    return choices[Math.floor(rng() * choices.length) % choices.length] ?? '';
  });
}

// Text after the first `skip` words of a prefix message, with its original line breaks kept
// (the prefix parser splits on whitespace and would flatten multi-line tag content).
function rawTail(content, prefix, skip) {
  let s = String(content ?? '');
  if (prefix && s.startsWith(prefix)) s = s.slice(prefix.length);
  s = s.replace(/^\s+/, '');
  for (let i = 0; i < skip; i++) s = s.replace(/^\S+/, '').replace(/^\s+/, '');
  return s;
}

// Per-user usage cooldown, in memory (a 3s window does not need to survive a restart).
function makeCooldown(ms = LIMITS.cooldownMs) {
  const last = new Map();
  return {
    // Returns 0 when allowed (and records the use), otherwise milliseconds left.
    hit(key, now = Date.now()) {
      const t = last.get(key);
      if (t !== undefined && now - t < ms) return ms - (now - t);
      last.set(key, now);
      if (last.size > 5000) for (const [k, v] of last) if (now - v >= ms) last.delete(k);
      return 0;
    },
  };
}

module.exports = { LIMITS, RESERVED, NAME_RE, normalizeName, nameError, contentError, renderTag, rawTail, makeCooldown };
