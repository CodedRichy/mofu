// Browser port of the bot's own chat parsers, so the landing demo answers the way the bot does.
// Sources: src/ai/actions.js (parseMuteIntent, parseSimple, usageHint) and src/utils/musicIntent.js.
// Trimmed word lists; the rules (verb position, explicit target, no questions, reason only after
// "for/because/cuz/since", 30m default) are the same. If those files change, change this too.
// The bot answers to its name (BRAND) and, during the rename, the old one: both are in TRIGGERS.
import { BRAND, TRIGGERS } from '../../lib/brand'

const TRIG = TRIGGERS.join('|')
const UNIT = { s: 's', sec: 's', secs: 's', second: 's', seconds: 's', m: 'm', min: 'm', mins: 'm', minute: 'm', minutes: 'm', h: 'h', hr: 'h', hrs: 'h', hour: 'h', hours: 'h', d: 'd', day: 'd', days: 'd', w: 'w', week: 'w', weeks: 'w' }
const MUTE_VERB = /\b(?:mute|timeout|time\s*out|silence|shush)\b/i
const UNMUTE_VERB = /\bun[-\s]?(?:mute|time\s*out|timeout)\b/i
const WARN_VERB = /\bwarn\b/i
const KICK_VERB = /\bkick\b/i
const NAME_AFTER = {
  mute: /\b(?:mute|timeout|time\s*out|silence|shush)\s+@?([^\s<>@,.!?]{3,32})/i,
  unmute: /\bun[-\s]?(?:mute|time\s*out|timeout)\s+@?([^\s<>@,.!?]{3,32})/i,
  warn: /\bwarn\s+@?([^\s<>@,.!?]{3,32})/i,
  kick: /\bkick\s+@?([^\s<>@,.!?]{3,32})/i,
}
const DURATION = /\b(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w)\b/i
const NAME_STOP = new Set('someone somebody anyone everyone people user member him her them this that me myself you it the and for now please pls again how what why when who can could should would does did command commands your my our their all here there is was are be to of in on at by with from about if not no do button mic level time chat channel server bot music lol lmao bro dude hey yo'.split(' ').concat(TRIGGERS))
const FOLLOW_BLOCK = new Set('your yours my his her their our its is was are were be been being button buttons mic the a an to of in on at with if but because when how why what who not dont never'.split(' '))
const PREFIX_FILLER = new RegExp(String.raw`^(?:(?:hey|yo|hi|hello|ok|okay|so|and|then|just|kindly|quickly|now|please|pls|plz|bot|${TRIG}|go ahead and|(?:can|could|would|will)\s+(?:you|u|ya)|(?:i\s+)?(?:want|need|wanna|would like|id like)\s+(?:you\s+)?to)(?:\s+|$))+`)
const looksLikeName = (n) => /^[\p{L}\p{N}_.-]+$/u.test(n) && !/^\d/.test(n)

function inCommandPosition(content, verbAt, verbLen) {
  let before = content.slice(0, verbAt).replace(/<@!?\d+>/g, ' @m ').toLowerCase()
  let named = -1, namedLen = 0
  for (const t of TRIGGERS) { const i = before.lastIndexOf(t); if (i > named) { named = i; namedLen = t.length } }
  if (named >= 0 && /@m[\s,:]*$/.test(before.slice(0, named))) return false
  if (named >= 0) before = before.slice(named + namedLen)
  before = before.replace(/[^a-z0-9@'\s]/g, ' ').replace(/'/g, '').replace(/\s+/g, ' ').trim()
  if (before) {
    let rest = before
    for (let prev = null; prev !== rest;) { prev = rest; rest = rest.replace(PREFIX_FILLER, '').trim() }
    if (named >= 0 && rest === '@m') rest = ''
    if (rest) return false
  }
  const next = content.slice(verbAt + verbLen).trimStart().match(/^@?([^\s<>,.!?;:]+)/)
  return !(next && FOLLOW_BLOCK.has(next[1].toLowerCase().replace(/'/g, '')))
}

function reasonOf(text) {
  const r = text.match(/\b(?:for|because|cuz|since)\s+(.+)$/i)
  return (r ? r[1] : '').replace(/@(everyone|here)/gi, '').replace(/\s+/g, ' ').trim()
    .replace(/^(?:(?:because|cuz|since|for)\s+)+/i, '').slice(0, 200) || 'No reason provided'
}

// content uses <@id> for mentions (the demo converts "@member" for known members first)
export function parseAction(content) {
  if (typeof content !== 'string' || content.length > 4000) return null
  if (/\?\s*$/.test(content.trim())) return null
  const hits = []
  for (const [kind, re] of [['unmute', UNMUTE_VERB], ['warn', WARN_VERB], ['kick', KICK_VERB], ['mute', MUTE_VERB]]) {
    const m = re.exec(content)
    if (m) hits.push([kind, m.index, m[0].length])
  }
  if (!hits.length) return null
  hits.sort((a, b) => a[1] - b[1])
  const [kind, at, len] = hits[0]
  if (!inCommandPosition(content, at, len)) return null

  const targetIds = [...new Set([...content.matchAll(/<@!?(\d+)>/g)].map((m) => m[1]))]
  let text = content.replace(/<@!?\d+>/g, ' ')
  let targetName = null
  if (!targetIds.length) {
    const nm = text.match(NAME_AFTER[kind])
    if (!nm || !looksLikeName(nm[1]) || NAME_STOP.has(nm[1].toLowerCase())) return null
    targetName = nm[1]
    text = text.replace(nm[0], ' ')
  }
  let duration = null
  if (kind === 'mute') {
    duration = '30m'
    const d = text.match(DURATION)
    if (d) { duration = `${d[1]}${UNIT[d[2].toLowerCase()]}`; text = text.replace(d[0], ' ') }
  }
  return { kind, targetIds, targetName, duration, reason: reasonOf(text) }
}

const HINTS = {
  mute: `mute who? \`${BRAND} mute @someone 10m reason\``,
  timeout: `timeout who? \`${BRAND} mute @someone 10m reason\``,
  unmute: `unmute who? \`${BRAND} unmute @someone\``,
  warn: `warn who? \`${BRAND} warn @someone reason\``,
  kick: `kick who? \`${BRAND} kick @someone reason\``,
}
const HINT_FILLER = new Set([...TRIGGERS,'yo', 'hey', 'hi', 'hello', 'please', 'pls', 'plz', 'can', 'you', 'could', 'now', 'just'])
export function usageHint(content) {
  if (/<@!?\d+>/.test(content)) return null
  const words = content.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w && !HINT_FILLER.has(w))
  if (words.length === 1) return HINTS[words[0]] || null
  if (words.length >= 2 && words[1] === 'someone' && HINTS[words[0]]) return HINTS[words[0]]
  return null
}

// ---- music (src/utils/musicIntent.js) ----
const BARE_VERBS = new Set(['stop', 'skip', 'pause', 'resume', 'shuffle', 'queue', 'nowplaying'])
const LOOP_MODES = new Set(['off', 'track', 'queue', 'autoplay', 'song', 'none'])
const PLAY_STOP_START = new Set('it that this these those me us my our your you i we he she they along around nice dumb fair dead hard safe smart cool cute games game with for again to on in at of as by up down out back nothing something anything well ball pretend'.split(' '))
const ARTICLES = new Set(['the', 'a', 'an'])
const ARTICLE_IDIOMS = new Set('fool game games part victim role hero devil long same field martyr innocent dumb smart hard safe nice cool dead ball card cards trick clown idiot way'.split(' '))
const VERB_PHRASES = {
  stop: /^(?:the\s+)?(?:music|song|track|player|playback)$/i,
  pause: /^(?:the\s+)?(?:music|song|track|player|playback)$/i,
  resume: /^(?:the\s+)?(?:music|song|track|player|playback)$/i,
  skip: /^(?:this|the\s+(?:song|track|current\s+(?:song|track)))(?:\s+(?:song|track|one))?$/i,
}
const CLAUSE_MARKERS = [/,\s*(?:i|you|we|he|she|they|it|that|this|but|and|so|because|why|what)\b/i, /\sbeing\s/i, /\slike\s/i, /\sso\s/i, /\sbecause\s/i, /\sbut\s/i, /\sif\s/i, /\swhen\s/i, /\?\s*$/]
const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

const MUSIC_CALL = new RegExp(String.raw`^\s*(?:(?:hey|yo)\s+)?(?:${TRIG})[,:]?\s+(play|skip|pause|resume|stop|queue|shuffle|loop|volume|nowplaying)\b(.*)$`, 'is')
export function parseMusic(content) {
  if (typeof content !== 'string' || !content || content.length > 300) return null
  const m = content.match(MUSIC_CALL)
  if (!m) return null
  const verb = m[1].toLowerCase()
  const rest = m[2].trim().replace(/\s*(?:please|pls|plz|now)?\s*[.!]*\s*$/i, '').trim()
  if (BARE_VERBS.has(verb)) {
    if (rest && !(VERB_PHRASES[verb] && VERB_PHRASES[verb].test(rest))) return null
    return { verb, args: '' } // the bot maps resume -> pause (a toggle); the demo keeps resume distinct on purpose
  }
  if (!rest) return null
  if (verb === 'loop') {
    const mode = rest.toLowerCase()
    if (!LOOP_MODES.has(mode)) return null
    return { verb, args: mode === 'song' ? 'track' : mode === 'none' ? 'off' : mode }
  }
  if (verb === 'volume') {
    const n = rest.match(/^(?:to\s+|at\s+)?(\d{1,3})\s*%?$/i)
    if (!n) return null
    const level = parseInt(n[1], 10)
    return level >= 1 && level <= 100 ? { verb, args: String(level) } : null
  }
  const quoted = /^["“].+["”]$/.test(rest)
  if (!quoted && CLAUSE_MARKERS.some((r) => r.test(` ${rest}`))) return null
  const tokens = rest.replace(/^["“]|["”]$/g, '').split(/\s+/).filter(Boolean)
  if (!tokens.length) return null
  if (!/^https?:\/\//i.test(rest)) {
    const first = norm(tokens[0]), second = tokens[1] ? norm(tokens[1]) : ''
    if (PLAY_STOP_START.has(first)) return null
    if (ARTICLES.has(first) && (tokens.length < 2 || ARTICLE_IDIOMS.has(second))) return null
    if (!tokens.some((t) => !PLAY_STOP_START.has(norm(t)) && !ARTICLES.has(norm(t)))) return null
  }
  return { verb, args: rest.replace(/^["“]|["”]$/g, '') }
}

// src/utils/duration.js parse + format: "90m" -> "1h 30m", two units at most
export function durationMs(d) {
  const m = /^(\d+)([smhdw])$/.exec(d || '')
  return m ? +m[1] * { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 }[m[2]] : 0
}
export function formatMs(ms) {
  let rest = Math.max(0, Math.floor(ms))
  const parts = []
  for (const [name, size] of [['d', 864e5], ['h', 36e5], ['m', 6e4], ['s', 1e3]]) {
    const n = Math.floor(rest / size)
    if (n > 0) { parts.push(`${n}${name}`); rest -= n * size }
    if (parts.length === 2) break
  }
  return parts.join(' ') || '0s'
}
