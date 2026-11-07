import { useCallback, useEffect, useReducer } from 'react'
import { Embed, DButton, BotIcon, clock } from './Discord'
import { BRAND } from '../../lib/brand'

// Replica of the live music card the bot posts (src/music/card.js buildCard): one embed + one row of five buttons.
// Like the real card, the embed is only re-rendered every TICK seconds while playing (the bot edits the message on
// a timer) and immediately when a button is pressed. No audio; time runs in the browser. Mock tracks only.

const TICK = 6
const BAR = 18
const DISC = ['◐', '◓', '◑', '◒'] // the same half-filled circles card.js cycles
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
function bar(cur, tot) {
  if (!tot) return '▬'.repeat(BAR)
  const pos = Math.min(BAR - 1, Math.floor((cur / tot) * BAR))
  return '▬'.repeat(pos) + '🔘' + '▬'.repeat(BAR - 1 - pos)
}

export const DEMO_QUEUE = [
  { title: 'Midnight Drive', author: 'Example Artist', len: 243 },
  { title: 'Paper Lanterns', author: 'Example Artist', len: 200 },
  { title: 'Slow Static', author: 'Sample Band', len: 266 },
  { title: 'Harbor Lights', author: 'Demo Ensemble', len: 229 },
]

// deterministic 2:30-4:30 length for a typed search, so the same query always looks the same
export function trackFromQuery(q) {
  let h = 0
  for (const c of q) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return { title: q.replace(/\b\w/g, (c) => c.toUpperCase()), author: 'Example Artist', len: 150 + (h % 120) }
}

const LOOPS = ['off', 'track', 'queue']
// pos = real playback position; shown = position the card last rendered (what Discord would be showing)
const initial = { tracks: DEMO_QUEUE, idx: 0, pos: 34, shown: 34, frame: 0, playing: true, loop: 'off', ended: null, fresh: true, at: clock() }

function step(s, a) {
  const now = (x) => ({ ...x, shown: x.pos })
  switch (a.type) {
    case 'tick': {
      if (!s.playing || s.ended) return s
      const t = s.tracks[s.idx]
      const pos = s.pos + a.dt
      if (pos >= t.len) {
        if (s.loop === 'track') return { ...s, pos: 0, shown: 0, frame: 0 }
        if (s.idx + 1 < s.tracks.length) return { ...s, idx: s.idx + 1, pos: 0, shown: 0, frame: 0, at: clock() }
        if (s.loop === 'queue') return { ...s, idx: 0, pos: 0, shown: 0, frame: 0, at: clock() }
        return { ...s, playing: false, ended: 'Record stopped. Queue finished.' }
      }
      // the bot edits the card every ~6s while playing, advancing the disc frame each edit
      return pos - s.shown >= TICK ? { ...s, pos, shown: pos, frame: s.frame + 1 } : { ...s, pos }
    }
    case 'toggle': return s.ended ? s : now({ ...s, playing: !s.playing })
    case 'skip': {
      if (s.ended) return s
      // skip posts a fresh card for the next track
      if (s.idx + 1 < s.tracks.length) return { ...s, idx: s.idx + 1, pos: 0, shown: 0, frame: 0, playing: true, at: clock() }
      if (s.loop === 'queue') return { ...s, idx: 0, pos: 0, shown: 0, frame: 0, playing: true, at: clock() }
      return { ...s, playing: false, ended: 'Record stopped. Queue finished.' }
    }
    case 'loop': return s.ended ? s : now({ ...s, loop: a.mode || LOOPS[(LOOPS.indexOf(s.loop) + 1) % LOOPS.length] })
    case 'shuffle': {
      if (s.ended) return s
      const rest = s.tracks.slice(s.idx + 1)
      for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]] }
      return now({ ...s, tracks: [...s.tracks.slice(0, s.idx + 1), ...rest] })
    }
    case 'stop': return s.ended ? s : { ...s, playing: false, ended: 'Record stopped.' }
    case 'reset': return { ...initial, fresh: false, at: clock() }
    case 'init': return { ...initial, at: clock() }
    case 'play': {
      // nothing playing (or the untouched demo queue): this track starts now on a fresh card. Otherwise it queues.
      if (s.ended) return { ...initial, fresh: false, tracks: [a.track], pos: 0, shown: 0, at: clock() }
      if (s.fresh) return { ...initial, fresh: false, tracks: [a.track, ...DEMO_QUEUE], pos: 0, shown: 0, at: clock() }
      return { ...s, tracks: [...s.tracks, a.track] }
    }
    default: return s
  }
}
// touching anything means the visitor owns the queue now, so "play" stops replacing the demo track
function reducer(s, a) {
  const r = step(s, a)
  return r !== s && a.type !== 'tick' && a.type !== 'init' && r.fresh ? { ...r, fresh: false } : r
}

export function usePlayer() {
  const [s, dispatch] = useReducer(reducer, initial)
  useEffect(() => {
    if (!s.playing) return undefined
    let last = performance.now()
    const id = setInterval(() => { const n = performance.now(); dispatch({ type: 'tick', dt: (n - last) / 1000 }); last = n }, 500)
    return () => clearInterval(id)
  }, [s.playing])
  const act = useCallback((type, extra) => dispatch({ type, ...extra }), [])
  return [s, act]
}

// Chat-command side effects, with the replies the real commands send (src/commands/music/*.js)
export function musicCommand(s, act, { verb, args }) {
  const idle = !!s.ended
  const none = { text: 'Nothing is playing.', tone: 'error' }
  switch (verb) {
    case 'play': {
      const track = trackFromQuery(args)
      act('play', { track })
      // a track that starts immediately gets the card (the "added" reply is deleted); a queued one gets "Added to queue"
      return idle || s.fresh ? { card: true } : { added: track }
    }
    case 'skip': if (idle) return none; act('skip'); return { text: `Skipped **${s.tracks[s.idx].title}**`, tone: 'success' }
    // /pause toggles (src/commands/music/pause.js). "resume" only ever resumes; the bot currently maps resume to
    // the pause toggle, a known bot bug that the demo deliberately does not copy.
    case 'pause': if (idle) return none; act('toggle'); return { text: `${s.playing ? 'Paused' : 'Resumed'} playback.`, tone: 'success' }
    case 'resume': if (idle) return none; if (!s.playing) act('toggle'); return { text: 'Resumed playback.', tone: 'success' }
    case 'stop': if (idle) return none; act('stop'); return { text: 'Stopped playback and cleared queue.', tone: 'muted' }
    case 'loop': if (idle) return none; act('loop', { mode: args === 'autoplay' ? 'queue' : args }); return { text: `Loop mode set to **${args}**`, tone: 'success' }
    case 'shuffle': {
      if (idle) return { text: 'Queue is empty.', tone: 'error' }
      const n = s.tracks.length - s.idx - 1
      act('shuffle'); return { text: n < 2 ? 'Nothing to shuffle: fewer than two tracks are queued.' : `Shuffled **${n}** tracks.`, tone: 'success' }
    }
    case 'volume': return idle ? none : { text: `Volume set to **${args}%**`, tone: 'success' }
    default: return { card: true }
  }
}

// neutral album-art placeholder: no artwork, just a tile with a note glyph
export function ArtTile() {
  return (
    <svg className="dc-art" viewBox="0 0 80 80" aria-hidden="true" focusable="false">
      <rect width="80" height="80" rx="4" fill="oklch(0.3 0.006 270)" />
      <circle cx="40" cy="40" r="22" fill="none" stroke="oklch(0.42 0.006 270)" strokeWidth="1.5" />
      <path d="M44 28v18.5a5 5 0 1 1-3-4.6V31l-8 2v15.5a5 5 0 1 1-3-4.6V31z" fill="oklch(0.62 0.008 270)" transform="translate(4 0)" />
    </svg>
  )
}

export function MusicCard({ player, act }) {
  const { tracks, idx, shown, frame, playing, loop, ended, at } = player
  if (ended) {
    return (
      <div className="dc-card">
        <Embed color="muted" at={at}>{ended}</Embed>
      </div>
    )
  }
  const t = tracks[idx]
  const next = tracks[idx + 1]
  const more = tracks.length - idx - 2
  const desc = (
    <>
      <b className="dc-link">{t.title}</b><br />
      {t.author}<br /><br />
      {!playing && <>Needle lifted.<br /></>}
      <code className="dc-code">{fmt(shown)}</code> <span className="dc-bar">{bar(shown, t.len)}</span> <code className="dc-code">{fmt(t.len)}</code>
    </>
  )
  return (
    <div className="dc-card">
      <Embed
        color={playing ? 'primary' : 'muted'}
        author={playing ? `NOW SPINNING  ${DISC[frame % DISC.length]}` : 'RECORD STOPPED  ||'}
        thumb={<ArtTile />}
        fields={[
          { name: 'Loop', value: <code className="dc-code">{loop}</code>, inline: true },
          { name: 'Up next', value: next ? `${next.title.length > 60 ? `${next.title.slice(0, 57)}...` : next.title}${more > 0 ? ` (+${more})` : ''}` : 'nothing queued', inline: true },
        ]}
        footer={`requested by member - ${BRAND}`}
        at={at}
      >{desc}</Embed>
      <div className="dc-row" role="group" aria-label="Music card buttons">
        <DButton kind={playing ? 'secondary' : 'success'} onClick={() => act('toggle')}>{playing ? 'Pause' : 'Resume'}</DButton>
        <DButton onClick={() => act('skip')}>Skip</DButton>
        <DButton onClick={() => act('loop')}>Loop: {loop}</DButton>
        <DButton onClick={() => act('shuffle')}>Shuffle</DButton>
        <DButton kind="danger" onClick={() => act('stop')}>Stop</DButton>
      </div>
    </div>
  )
}

export function AddedToQueue({ track }) {
  return (
    <Embed color="success" author="Added to queue" thumb={<ArtTile />} at={clock()}>
      <b className="dc-link">{track.title}</b><br />{track.author} {'·'} {fmt(track.len)}
    </Embed>
  )
}

export { BotIcon }
