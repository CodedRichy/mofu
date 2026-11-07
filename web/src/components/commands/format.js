// Pure helpers for the Commands page: usage strings, search scoring, category metadata.

export const DEFAULT_PREFIX = ';'

// display order and labels; anything new the generator finds still shows (sorted after these)
export const CATEGORY_META = {
  moderation: { label: 'Moderation', blurb: 'Bans, mutes, warnings, purges and the case history behind them.' },
  config: { label: 'Config', blurb: 'Welcome flows, protection, logging, tickets and everything you set once.' },
  ai: { label: 'AI', blurb: 'Ask, summarise and read the room.' },
  utility: { label: 'Utility', blurb: 'Lookups, reminders, polls and server insight.' },
  leveling: { label: 'Leveling', blurb: 'XP, rank cards and level settings.' },
  economy: { label: 'Economy', blurb: 'Coins, the bank, the shop and games of chance.' },
  music: { label: 'Music', blurb: 'Playback and the queue.' },
  fun: { label: 'Fun', blurb: 'Games, reactions and silly text.' },
  lastfm: { label: 'Last.fm', blurb: 'Now playing and listening stats.' },
}

export const catLabel = (c) => CATEGORY_META[c]?.label || c.charAt(0).toUpperCase() + c.slice(1)

export function orderCategories(list) {
  const known = Object.keys(CATEGORY_META)
  return [...new Set(list)].sort((a, b) => {
    const ia = known.indexOf(a), ib = known.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
  })
}

const arg = (o) => (o.required ? `<${o.name}>` : `[${o.name}]`)
const args = (opts = []) => opts.map(arg).join(' ')

// One usage line per variant (a command with subcommands gets one per subcommand).
export function usageLines(cmd, prefix = DEFAULT_PREFIX) {
  const variants = cmd.subcommands?.length
    ? cmd.subcommands.map((s) => ({ tail: `${s.name}${s.options.length ? ' ' + args(s.options) : ''}`, desc: s.desc, options: s.options }))
    : [{ tail: args(cmd.options), desc: null, options: cmd.options || [] }]
  return variants.map((v) => ({
    slash: cmd.slash ? `/${cmd.name}${v.tail ? ' ' + v.tail : ''}` : null,
    prefix: `${prefix}${cmd.name}${v.tail ? ' ' + v.tail : ''}`,
    desc: v.desc,
    options: v.options,
  }))
}

// the form a user is most likely to want on the clipboard
export const primaryForm = (cmd, prefix = DEFAULT_PREFIX) => (cmd.slash ? `/${cmd.name}` : `${prefix}${cmd.name}`)

// Score a command against a query. 0 = no match. Higher = better. Name hits beat alias hits beat text hits.
export function score(cmd, q) {
  if (!q) return 1
  const name = cmd.name
  if (name === q) return 100
  if (name.startsWith(q)) return 80 - (name.length - q.length) * 0.1
  if (cmd.aliases.includes(q)) return 70
  if (name.includes(q)) return 60
  if (cmd.aliases.some((a) => a.startsWith(q))) return 50
  if (cmd.subcommands?.some((s) => s.name.includes(q))) return 40
  if (cmd.desc.toLowerCase().includes(q)) return 30
  if (catLabel(cmd.category).toLowerCase().includes(q)) return 20
  if (cmd.subcommands?.some((s) => s.desc.toLowerCase().includes(q))) return 10
  return 0
}

// normalise what people type: "/ban", ";ban", "  Ban " all mean "ban"
export const normaliseQuery = (raw) => raw.trim().toLowerCase().replace(/^[/;]+/, '').replace(/\s+/g, ' ')
