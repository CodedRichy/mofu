import { useCallback, useEffect, useRef, useState } from 'react'
import { SendHorizontal, RotateCcw, Hash, CornerUpRight } from 'lucide-react'
import { parseAction, parseMusic, usageHint, durationMs, formatMs } from './demoParse'
import { MusicCard, musicCommand, AddedToQueue } from './MusicPlayer'
import { Embed, DButton, Md, MemberIcon, BotIcon, clock, relative } from './Discord'

// A working mock of Sonder in a Discord channel. Requests go through a copy of the bot's parsers (demoParse.js);
// checks, card layouts and wording follow src/ai/actions.js and src/utils/embed.js. Nothing leaves the browser.

const ME = { id: '221034718840209408', name: 'Moderator', role: 'Mods', pos: 3 }
const CAST = [
  ME,
  { id: '448812093355773952', name: 'member', role: 'Members', pos: 1 },
  { id: '993011873320611840', name: 'member2', role: 'Members', pos: 1 },
  { id: '512300984412778496', name: 'user', role: 'Members', pos: 1 },
  { id: '300119875533220864', name: 'admin', role: 'Admin', pos: 5 },
]
const NAMES = CAST.map((m) => m.name.toLowerCase())
const byId = (id) => CAST.find((m) => m.id === id)
const PERM = { mute: 'Moderate Members', unmute: 'Moderate Members', warn: 'Moderate Members', kick: 'Kick Members' }
const TTL = 120000
const MAX_MUTE = 2419200000
const MAX_LEN = 2000 // Discord's message limit

export const EXAMPLES = [
  'sonder mute @member 10m for spamming links',
  'sonder play ocean static',
  'sonder what can you do',
  'sonder warn @member2 for caps spam',
  'sonder kick @admin',
]

const CAN_DO = "i moderate (mute, warn, kick, ban, purge, case history), play music in voice, run levels and an economy, and handle setup like welcome messages, logging, tickets and reaction roles. say `sonder mute @someone 10m for spam` and i'll show you exactly what i'll do before anything happens. everything else: `/help`"
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 3)}...` : s)

function resolveName(name, gone) {
  const lower = name.toLowerCase()
  const present = CAST.filter((m) => !gone.has(m.id))
  const exact = present.filter((m) => m.name.toLowerCase() === lower)
  if (exact.length === 1) return { id: exact[0].id }
  const part = present.filter((m) => m.name.toLowerCase().includes(lower))
  if (part.length === 1) return { id: part[0].id }
  if (!part.length) return { error: `couldn't find anyone called "${name}". @mention them instead.` }
  return { error: `more than one match for "${name}" (${part.map((m) => m.name).join(', ')}). @mention the one you mean.` }
}

// actions.js commandText
function commandText(kind, target, dur, reason) {
  const parts = [`/${kind}`, `@${target.name}`]
  if (kind === 'mute' && dur) parts.push(dur)
  if (kind !== 'unmute' && reason) parts.push(clip(reason, 80))
  return clip(parts.join(' '), 200)
}

// unique across HMR re-evaluations too (a module counter would restart while state keeps old ids)
const nid = () => `m${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36)}`
const DELAY = 550 // every bot reply uses the same delay, so replies land in the order they were asked

export function ChatDemo({ player, act, setAudit, prefill }) {
  const [msgs, setMsgs] = useState([])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const [tab, setTab] = useState('chat')
  const [unseen, setUnseen] = useState(0)
  const [modlog, setModlog] = useState([])
  const [now, setNow] = useState(() => Date.now())
  const [chatUnseen, setChatUnseen] = useState(0)
  const [announce, setAnnounce] = useState('')
  const tabRef = useRef('chat')
  tabRef.current = tab
  const world = useRef({ muted: new Set(), gone: new Set(), warns: {} })
  const pending = useRef(false) // one open card per person (actions.js hasPending), set synchronously
  const timers = useRef([])
  const logRef = useRef(null)
  const inputRef = useRef(null)
  const playerRef = useRef(player)
  playerRef.current = player
  const auditN = useRef(0)
  const seeded = useRef(false)

  const later = useCallback((fn, ms) => { const t = setTimeout(fn, ms); timers.current.push(t) }, [])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const push = useCallback((m) => {
    setMsgs((xs) => [...xs, { id: nid(), at: clock(), ...m }])
    if (m.who !== 'me' && tabRef.current !== 'chat') setChatUnseen((u) => u + 1)
  }, [])
  const botSay = useCallback((m, delay = DELAY) => {
    setTyping(true)
    later(() => { setTyping(false); push({ who: 'bot', ...m }) }, delay)
  }, [later, push])

  const addAudit = useCallback((row) => { const n = ++auditN.current; setAudit((xs) => [{ n, ...row }, ...xs].slice(0, 6)); return n }, [setAudit])
  const setAuditStatus = useCallback((n, status) => setAudit((xs) => xs.map((r) => (r.n === n ? { ...r, status } : r))), [setAudit])

  const propose = useCallback((intent, replyTo) => {
    const w = world.current
    const say = (text, tone = 'error') => botSay({ type: 'embed', text, tone, replyTo })
    const kind = intent.kind
    if (intent.targetIds.length > 1) return say(`one person at a time. tell me who to ${kind}.`)
    // The opening card is a sample, not something the visitor asked for: their first request retires it
    // (shown as the bot's real CANCELLED card) instead of being refused. Their own cards keep the real rule.
    const sample = msgsRef.current.find((x) => x.type === 'proposal' && x.status === 'open' && x.sample)
    if (sample) {
      pending.current = false
      setMsgs((xs) => xs.map((x) => (x.id === sample.id ? { ...x, status: 'cancelled' } : x)))
      setAuditStatus(sample.auditN, 'cancelled')
    }
    if (pending.current) return say('you already have one waiting. confirm or cancel it first.', 'muted')
    let targetId = intent.targetIds[0]
    if (!targetId) {
      const found = resolveName(intent.targetName, w.gone)
      if (found.error) return say(found.error)
      targetId = found.id
    }
    const target = byId(targetId)
    if (!target || w.gone.has(targetId)) return say("that member isn't in the server.")
    if (target.id === ME.id) return say(`you can't ${kind} yourself.`)
    if (target.pos >= ME.pos) return say(`you can't ${kind} someone with a higher or equal role.`)
    if (kind === 'unmute' && !w.muted.has(targetId)) return say(`${target.name} isn't muted.`)
    let dur = null, ms = 0
    if (kind === 'mute') {
      ms = durationMs(intent.duration)
      if (!ms) return say('invalid duration. try `30m`, `1h`, `1d`.')
      if (ms > MAX_MUTE) return say("mutes can't be longer than 28 days.")
      dur = formatMs(ms)
    }
    pending.current = true
    const n = addAudit({ kind, target: target.name, durMs: ms, reason: intent.reason, status: 'proposed' })
    setTyping(true)
    later(() => {
      setTyping(false)
      setNow(Date.now())
      push({ who: 'bot', type: 'proposal', kind, targetId, dur, reason: intent.reason, expiresAt: Date.now() + TTL, status: 'open', auditN: n, replyTo })
    }, DELAY)
  }, [addAudit, botSay, later, push, setAuditStatus])

  const send = useCallback((raw) => {
    const text = String(raw).trim().slice(0, MAX_LEN)
    if (!text) return
    push({ who: 'me', type: 'said', text })
    const replyTo = clip(text, 60)
    if (!/\bsonder\b/i.test(text)) {
      later(() => push({ who: 'sys', type: 'note', text: 'Sonder only answers messages that say its name. Start with "sonder".' }), DELAY)
      return
    }
    const music = parseMusic(text)
    if (music) {
      setTyping(true)
      later(() => {
        setTyping(false)
        const r = musicCommand(playerRef.current, act, music)
        if (r.card) push({ who: 'bot', type: 'player' }) // the card is a new channel message, not a reply
        else if (r.added) push({ who: 'bot', type: 'added', track: r.added, replyTo })
        else push({ who: 'bot', type: 'embed', text: r.text, tone: r.tone, replyTo })
      }, DELAY)
      return
    }
    // "@member" -> "<@id>", the form the bot's parser sees
    const wire = text.replace(/@([\w.-]+)/g, (all, name) => {
      const m = CAST.find((c) => c.name.toLowerCase() === name.toLowerCase())
      return m ? `<@${m.id}>` : all
    })
    const intent = parseAction(wire)
    if (intent) return propose(intent, replyTo)
    const hint = usageHint(wire)
    if (hint) return botSay({ type: 'plain', text: hint, replyTo })
    if (/what can you do|what do you do|\bhelp\b|commands/i.test(text)) return botSay({ type: 'plain', text: CAN_DO, replyTo })
    later(() => push({ who: 'sys', type: 'note', text: 'In a real server the chat model answers this in its own words. This demo only runs the parts that are code: mute, unmute, warn, kick and music. Try one of the examples.' }), DELAY)
  }, [act, botSay, later, propose, push])

  const resolve = (id, verb) => {
    const m = msgsRef.current.find((x) => x.id === id)
    if (!m || m.status !== 'open') return
    pending.current = false
    // the pressed button unmounts when the card is edited: hand keyboard focus to the input, announce the outcome
    inputRef.current?.focus({ preventScroll: true })
    // checked at press time, not only by the 1s ticker (a throttled background tab can lag behind)
    if (!m.sample && m.expiresAt <= Date.now()) {
      setMsgs((xs) => xs.map((x) => (x.id === id ? { ...x, status: 'expired' } : x)))
      setAuditStatus(m.auditN, 'expired')
      setAnnounce('That one expired. Nothing was done.')
      return
    }
    if (verb === 'no') {
      setMsgs((xs) => xs.map((x) => (x.id === id ? { ...x, status: 'cancelled' } : x)))
      setAuditStatus(m.auditN, 'cancelled')
      setAnnounce('Cancelled. Nothing was done.')
      return
    }
    const w = world.current
    const target = byId(m.targetId)
    let extra = null
    if (m.kind === 'mute') w.muted.add(m.targetId)
    if (m.kind === 'unmute') w.muted.delete(m.targetId)
    if (m.kind === 'kick') { w.gone.add(m.targetId); w.muted.delete(m.targetId) }
    if (m.kind === 'warn') { w.warns[m.targetId] = (w.warns[m.targetId] || 0) + 1; extra = `Warning #${w.warns[m.targetId]}` }
    const entry = { kind: m.kind, target, reason: `${m.reason} (via Sonder AI, confirmed by ${ME.name})`, dur: m.dur, extra, at: clock() }
    setMsgs((xs) => [...xs.map((x) => (x.id === id ? { ...x, status: 'done', entry } : x)), { id: nid(), at: clock(), who: 'sys', type: 'logged' }])
    setModlog((xs) => [...xs, { id: nid(), ...entry }])
    setUnseen((u) => u + 1)
    setAuditStatus(m.auditN, 'executed')
    setAnnounce(`Done: ${m.kind} ${target.name}${m.dur ? ` for ${m.dur}` : ''}. Posted to mod-log.`)
  }
  const msgsRef = useRef(msgs)
  msgsRef.current = msgs

  // seed: a request already made, its card live and counting down
  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    pending.current = true
    const n = addAudit({ kind: 'mute', target: 'member', durMs: 600000, reason: 'spamming links', status: 'proposed' })
    setMsgs([
      { id: nid(), at: clock(), who: 'me', type: 'said', text: EXAMPLES[0] },
      { id: nid(), at: clock(), who: 'bot', type: 'proposal', kind: 'mute', targetId: CAST[1].id, dur: '10m', reason: 'spamming links', expiresAt: Date.now() + TTL, status: 'open', auditN: n, replyTo: EXAMPLES[0], sample: true },
    ])
  }, [addAudit])

  // expiry (actions.js PENDING_TTL_MS), only ticking while a card is open
  const open = msgs.some((x) => x.type === 'proposal' && x.status === 'open')
  useEffect(() => {
    if (!open) return undefined
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [open])
  useEffect(() => {
    // the opening sample card re-arms instead of expiring, so an idle visitor never returns to a dead demo
    if (msgs.some((x) => x.sample && x.status === 'open' && x.expiresAt <= now + 30000)) {
      setMsgs((xs) => xs.map((x) => (x.sample && x.status === 'open' ? { ...x, expiresAt: Date.now() + TTL } : x)))
    }
    const expired = msgs.filter((x) => x.type === 'proposal' && x.status === 'open' && !x.sample && x.expiresAt <= now)
    if (!expired.length) return
    pending.current = false
    setMsgs((xs) => xs.map((x) => (expired.some((e) => e.id === x.id) ? { ...x, status: 'expired' } : x)))
    expired.forEach((e) => setAuditStatus(e.auditN, 'expired'))
  }, [now]) // eslint-disable-line react-hooks/exhaustive-deps

  // keep the newest message in view without scrolling the page
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight }, [msgs, typing, tab])

  useEffect(() => {
    if (!prefill?.text) return
    setTab('chat')
    setInput(prefill.text)
    const el = inputRef.current
    if (!el) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.closest('.cd')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
    el.focus({ preventScroll: true })
  }, [prefill])

  const reset = () => {
    timers.current.forEach(clearTimeout); timers.current = []
    world.current = { muted: new Set(), gone: new Set(), warns: {} }
    pending.current = false
    setAudit((xs) => xs.map((r) => (r.status === 'proposed' ? { ...r, status: 'expired' } : r)))
    setTyping(false); setModlog([]); setUnseen(0); setChatUnseen(0); setTab('chat'); setInput(''); setMsgs([])
    act('init') // the demo queue too, so "Reset" means the whole demo
    setAnnounce('Demo reset.')
    inputRef.current?.focus({ preventScroll: true })
  }

  const latestPlayer = [...msgs].reverse().find((x) => x.type === 'player')?.id
  const showTab = (t) => { setTab(t); if (t === 'log') setUnseen(0); else setChatUnseen(0) }
  // WAI-ARIA tabs: arrows / Home / End move between the two channels, one tab stop
  const tabKey = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const t = e.key === 'Home' ? 'chat' : e.key === 'End' ? 'log' : tab === 'chat' ? 'log' : 'chat'
    showTab(t)
    document.getElementById(t === 'chat' ? 'cd-tab-chat' : 'cd-tab-log')?.focus()
  }
  const submit = (e) => { e.preventDefault(); if (!input.trim()) return; send(input); setInput(''); setTab('chat') }

  return (
    <div className="cd">
      <div className="cd-top">
        <div className="cd-tabs" role="tablist" aria-label="Channels" onKeyDown={tabKey}>
          <button type="button" role="tab" id="cd-tab-chat" aria-selected={tab === 'chat'} aria-controls="cd-panel" tabIndex={tab === 'chat' ? 0 : -1} className="cd-tab" onClick={() => showTab('chat')}>
            <Hash size={14} aria-hidden="true" />mod-chat{chatUnseen > 0 && <span className="cd-badge"><span className="sr-only">, </span>{chatUnseen}<span className="sr-only"> new</span></span>}
          </button>
          <button type="button" role="tab" id="cd-tab-log" aria-selected={tab === 'log'} aria-controls="cd-panel" tabIndex={tab === 'log' ? 0 : -1} className="cd-tab" onClick={() => showTab('log')}>
            <Hash size={14} aria-hidden="true" />mod-log{unseen > 0 && <span className="cd-badge"><span className="sr-only">, </span>{unseen}<span className="sr-only"> new</span></span>}
          </button>
        </div>
        <button type="button" className="cd-reset" onClick={reset}><RotateCcw size={14} aria-hidden="true" /><span>Reset</span><span className="sr-only"> the demo</span></button>
      </div>

      <div id="cd-panel" role="tabpanel" aria-labelledby={tab === 'chat' ? 'cd-tab-chat' : 'cd-tab-log'} className="cd-scroll" ref={logRef} tabIndex={0}>
        {tab === 'chat' ? (
          <div className="cd-log" role="log" aria-live="polite" aria-relevant="additions" aria-label="Demo chat">
            {msgs.length === 0 && <p className="cd-empty">This is the start of #mod-chat. Type below, or pick an example.</p>}
            {msgs.map((m) => (
              <Message key={m.id} m={m} now={now} onResolve={resolve} onLog={() => showTab('log')} player={player} act={act} live={m.id === latestPlayer} />
            ))}
          </div>
        ) : (
          <div className="cd-log" aria-label="Moderation log">
            {modlog.length === 0 && <p className="cd-empty">This is the start of #mod-log. Confirm an action in #mod-chat and Sonder posts it here.</p>}
            {modlog.map((e) => (
              <div className="cd-msg" key={e.id}>
                <Avatar bot />
                <div className="cd-main">
                  <Who bot at={e.at} />
                  <ModAction e={e} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      <form className="cd-form" onSubmit={submit}>
        <div className="cd-typing" aria-hidden={!typing}>{typing && <><span className="cd-dots"><i /><i /><i /></span><b>sonder</b> is typing...</>}</div>
        <div className="cd-input">
          <label htmlFor="cd-in" className="sr-only">Message #mod-chat</label>
          <input id="cd-in" ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Message #mod-chat" autoComplete="off" spellCheck="false" maxLength={MAX_LEN} />
          <button type="submit" className="cd-send" aria-label="Send" disabled={!input.trim()}><SendHorizontal size={17} aria-hidden="true" /></button>
        </div>
        <div className="cd-chips" role="group" aria-label="Example messages, sent when pressed">
          <span className="cd-try">Try</span>
          {EXAMPLES.map((x) => (
            <button type="button" key={x} className="cd-chip" onClick={() => { setTab('chat'); send(x) }}>{x.replace(/^sonder /, '')}</button>
          ))}
        </div>
        <p className="cd-fine">Runs in your browser on a copy of the bot's parser rules. You are a moderator here; @admin outranks you.</p>
      </form>
    </div>
  )
}

function Avatar({ bot }) {
  return bot
    ? <div className="cd-avatar"><img src="/logo.jpg" alt="" /></div>
    : <div className="cd-avatar cd-avatar--me" aria-hidden="true">M</div>
}
function Who({ bot, at }) {
  return <div className="cd-who">{bot ? <>sonder <span className="cd-app">APP</span></> : ME.name}<span className="cd-time">Today at {at}</span></div>
}

// src/utils/embed.js modAction: author = ACTION + target avatar, target thumbnail, Member/Moderator/Reason lines
function ModAction({ e }) {
  return (
    <Embed color={e.kind === 'unmute' ? 'success' : 'warning'} author={e.kind.toUpperCase()} authorIcon={<MemberIcon name={e.target.name} />}
      thumb={<MemberIcon name={e.target.name} size={80} />} at={e.at}>
      <b>Member</b> {e.target.name} <code className="dc-code">{e.target.id}</code><br />
      <b>Moderator</b> {ME.name} <code className="dc-code">{ME.id}</code><br />
      <b>Reason</b> {e.reason}
      {e.dur && <><br /><b>Duration</b> {e.dur}</>}
      {e.extra && <><br /><b>Details</b> {e.extra}</>}
    </Embed>
  )
}

function Message({ m, now, onResolve, onLog, player, act, live }) {
  if (m.who === 'sys') {
    if (m.type === 'logged') return <div className="cd-sys">Posted to <button type="button" className="cd-linkbtn" onClick={onLog}>#mod-log</button> and recorded for <code className="dc-code">/aiactions</code>.</div>
    return <div className="cd-sys">{m.text}</div>
  }
  const bot = m.who === 'bot'
  return (
    <div className={`cd-msg ${bot ? '' : 'cd-msg--me'} ${m.replyTo ? 'has-reply' : ''}`}>
      {m.replyTo && (
        <div className="cd-replyto"><CornerUpRight size={12} aria-hidden="true" /><span className="cd-ravatar" aria-hidden="true">M</span><b>{ME.name}</b><span>{m.replyTo}</span></div>
      )}
      <Avatar bot={bot} />
      <div className="cd-main">
        <Who bot={bot} at={m.at} />
        {m.type === 'said' && <div className="cd-said"><Md text={m.text} mentions={NAMES} /></div>}
        {m.type === 'plain' && <div className="cd-said"><Md text={m.text} mentions={NAMES} /></div>}
        {m.type === 'embed' && <Embed color={m.tone} at={m.at}><Md text={m.text} /></Embed>}
        {m.type === 'added' && <AddedToQueue track={m.track} />}
        {m.type === 'player' && (live
          ? <MusicCard player={player} act={act} />
          : <Embed color="muted" at={m.at}>This card was replaced by a newer one.</Embed>)}
        {m.type === 'proposal' && <Proposal m={m} now={now} onResolve={onResolve} />}
      </div>
    </div>
  )
}

// actions.js proposalCard + buttons; on press the same message is edited into modAction or resultCard
function Proposal({ m, now, onResolve }) {
  const target = byId(m.targetId)
  if (m.status === 'done') return <ModAction e={m.entry} />
  if (m.status !== 'open') {
    return (
      <Embed color="muted" author={m.status === 'cancelled' ? 'CANCELLED' : 'EXPIRED'} footer="via Sonder AI" at={m.at}>
        <b>Action</b> {m.kind}<br />
        <b>Target</b> <span className="dc-mention">@{target.name}</span><br />
        {m.dur && <><b>Duration</b> {m.dur}<br /></>}
        Nothing was done.
      </Embed>
    )
  }
  const label = m.kind.charAt(0).toUpperCase() + m.kind.slice(1)
  const style = m.kind === 'unmute' ? 'success' : m.kind === 'warn' ? 'primary' : 'danger'
  return (
    <div className="dc-card">
      <Embed color="warning" author="AI ACTION PROPOSAL" authorIcon={<MemberIcon name={target.name} />} at={m.at}
        fields={[
          { name: 'Command', value: <pre className="dc-pre">{commandText(m.kind, target, m.dur, m.reason)}</pre> },
          { name: 'Reason', value: m.reason },
          { name: 'Target', value: <><span className="dc-mention">@{target.name}</span> - {target.role}</>, inline: true },
          { name: 'Who can confirm', value: <>Only <span className="dc-mention">@{ME.name}</span> (needs {PERM[m.kind]})</>, inline: true },
          { name: 'Expires', value: relative(m.expiresAt - now), inline: true },
        ]}
      />
      <div className="dc-row">
        <DButton kind={style} onClick={() => onResolve(m.id, 'ok')}>{label}</DButton>
        <DButton onClick={() => onResolve(m.id, 'no')}>Cancel</DButton>
      </div>
    </div>
  )
}

export { BotIcon }
