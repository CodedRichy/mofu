import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Layout } from '../components/Layout'
import { ChatDemo } from '../components/landing/ChatDemo'
import { MusicCard, usePlayer } from '../components/landing/MusicPlayer'
import { Switcher } from '../components/landing/Switcher'
import { Capabilities } from '../components/landing/Capabilities'
import { Embed, BotIcon, clock } from '../components/landing/Discord'
import '../styles/landing.css'

import { INVITE_URL } from '../lib/invite'

function Mascot() {
  return <span className="ln-mascot" aria-hidden="true"><img src="/logo.jpg" alt="" /></span>
}

// Halftone dot-matrix art, generated (no image fetch): dot radius follows a smooth field of overlapping blobs,
// so it reads as a printed halftone. Deterministic, so it renders the same every time.
const HCOLS = 110, HROWS = 64
const BLOBS = [[0.72, 0.38, 0.30, 1], [0.92, 0.82, 0.26, 0.9], [0.50, 0.95, 0.30, 0.8], [0.58, 0.10, 0.16, 0.7], [1.0, 0.15, 0.2, 0.8]]
function HalftoneArt() {
  const dots = []
  for (let y = 0; y < HROWS; y++) {
    for (let x = 0; x < HCOLS; x++) {
      const u = x / (HCOLS - 1), v = y / (HROWS - 1)
      let f = 0
      for (const [bx, by, br, bw] of BLOBS) {
        const d = Math.hypot((u - bx) * 1.6, v - by) / br
        f += bw * Math.exp(-d * d * 1.6)
      }
      f += 0.08 * Math.sin(u * 17 + v * 9) * f
      const r = Math.min(0.5, Math.max(0, (f - 0.16) * 0.55))
      if (r > 0.06) dots.push(<circle key={x + '-' + y} cx={x + 0.5} cy={y + 0.5} r={r} />)
    }
  }
  return (
    <svg className="ln-halftone" viewBox={`0 0 ${HCOLS} ${HROWS}`} preserveAspectRatio="xMaxYMid slice" aria-hidden="true" focusable="false">
      {dots}
    </svg>
  )
}

// With no VITE_DISCORD_CLIENT_ID there is no valid invite: an inert button, and (dev only) a note under the CTA row.
function AddToDiscord() {
  if (INVITE_URL) return <a className="ln-btn ln-btn--primary" href={INVITE_URL}>Add to Discord<Mascot /></a>
  return <span className="ln-btn ln-btn--primary is-off" role="link" aria-disabled="true">Add to Discord<Mascot /></span>
}
function DevNote() {
  if (INVITE_URL || !import.meta.env.DEV) return null
  return <p className="ln-devnote" role="note">Dev only: VITE_DISCORD_CLIENT_ID is not set, so the invite button is disabled. Set it in web/.env.</p>
}

function Reveal({ children, delay = 0, as: Tag = 'div', className = '', ...rest }) {
  const ref = useRef(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined' || new URLSearchParams(window.location.search).has('static')) { setSeen(true); return }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect() } }, { threshold: 0.12 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <Tag ref={ref} className={`ln-reveal ${seen ? 'is-in' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }} {...rest}>
      {children}
    </Tag>
  )
}

function useStats() {
  const [s, setS] = useState(null)
  useEffect(() => {
    let live = true
    fetch('/api/public-stats').then((r) => (r.ok ? r.json() : null)).then((d) => { if (live) setS(d) }).catch(() => {})
    return () => { live = false }
  }, [])
  return s
}

const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : '-')

// Each one checked against src/commands (leveling.js incl. voice XP, economy/*, welcome.js, goodbye.js,
// reactionrole.js, customcommand.js, moderation/*, music/*).
const INCLUDED = ['Leveling', 'Voice XP', 'Economy', 'Music', 'Moderation', 'Welcome & goodbye', 'Reaction roles', 'Custom commands']

// /aiactions as the bot sends it (src/commands/config/aiactions.js): an ephemeral response() embed
const STATUS = { executed: 'done', cancelled: 'cancelled', expired: 'expired', rejected: 'refused', failed: 'failed', proposed: 'waiting' }
function AuditReply({ rows }) {
  return (
    <div className="ln-audit">
      <div className="sw-cmdline"><span className="cd-ravatar" aria-hidden="true">M</span><b>Moderator</b><span>used</span><span className="dc-cmd">/aiactions</span></div>
      <div className="sw-bot"><BotIcon size={32} /><div aria-live="polite">
        <div className="cd-who">sonder <span className="cd-app">APP</span><span className="cd-time">Today at {clock()}</span></div>
        {rows.length === 0
          ? <Embed color="muted" at={clock()}>Nobody has asked Sonder to do anything in chat yet.</Embed>
          : (
            <Embed color="primary" at={clock()}>
              <b>Last {rows.length} chat actions</b>
              {rows.map((r) => (
                <div className="ln-audit-row" key={r.n}>
                  <code className="dc-code">#{r.n}</code> <b>{r.kind}</b>{r.durMs ? ` for ${Math.round(r.durMs / 60000)}m` : ''} <span className="dc-mention">@{r.target}</span> asked by <span className="dc-mention">@Moderator</span> {'·'} {STATUS[r.status]} {'·'} just now
                  <div className="ln-audit-why">reason: {r.reason || 'none'}</div>
                </div>
              ))}
            </Embed>
          )}
        <div className="sw-only">Only you can see this {'·'} Dismiss message</div>
      </div></div>
    </div>
  )
}

export function Landing() {
  const stats = useStats()
  const statItems = [[stats?.guilds, 'servers'], [stats?.members, 'members served'], [stats?.commands, 'commands']].filter(([n]) => typeof n === 'number')
  const [player, act] = usePlayer()
  const [audit, setAudit] = useState([])
  const [prefill, setPrefill] = useState(null)

  return (
    <Layout>
      <main className="ln">
        <div className="ln-hero-wrap">
          <section className="ln-hero" aria-labelledby="ln-h1">
            <div className="ln-glow" aria-hidden="true" />
            <HalftoneArt />
            <div className="ln-hero-copy">
              <h1 className="ln-h1" id="ln-h1">Switch bots. Keep your server. <span>Then just tell it what to do.</span></h1>
              <p className="ln-lede">
                Sonder runs next to the bot you have now, finds its prefix and channels, and brings your warnings over.
                Ask it in plain words; anything that can hurt waits for a moderator's button.
              </p>
              <div className="ln-cta">
                <AddToDiscord />
                <Link className="ln-btn ln-btn--ghost" to="/commands">Browse commands <ArrowRight size={18} aria-hidden="true" /></Link>
              </div>
              <DevNote />
              <div className="ln-free">
                <span className="ln-free-l">Free in Sonder today</span>
                <ul className="ln-pills">{INCLUDED.map((f) => <li key={f}>{f}</li>)}</ul>
              </div>
            </div>
            <ChatDemo player={player} act={act} setAudit={setAudit} prefill={prefill} />
          </section>
        </div>

        {statItems.length > 1 && (
          <Reveal as="section" className="ln-section ln-section--tight" aria-label="Live numbers">
            <div className="ln-stats">
              {statItems.map(([n, l]) => (
                <div className="ln-stat" key={l}><div className="ln-stat-n">{fmt(n)}</div><div className="ln-stat-l">{l}</div></div>
              ))}
            </div>
          </Reveal>
        )}

        <section className="ln-section" aria-labelledby="ln-switch">
          <Reveal>
            <div className="ln-eyebrow">Switching</div>
            <h2 className="ln-h2" id="ln-switch">Switch without starting over.</h2>
            <p className="ln-sub">Keep your old bot running. Sonder finds it, avoids its prefix, reuses its channels and imports your warnings. Turn the old one off when you are ready.</p>
          </Reveal>
          <Reveal delay={60}>
            <Switcher onTry={() => setPrefill({ text: 'sonder mute @member 10m for spamming links', n: Date.now() })} />
          </Reveal>
        </section>

        <section className="ln-section" aria-labelledby="ln-safe">
          <Reveal className="ln-panel">
            <div>
              <div className="ln-eyebrow">Safe by construction</div>
              <h2 className="ln-h2" id="ln-safe">It asks before it acts.</h2>
              <p className="ln-sub">
                The model only writes replies. Actions are matched by code, checked against the asker's own
                permissions and role when proposed and again on the button press, rate limited, and written to an
                audit table you read with <code className="dc-code">/aiactions</code>.
              </p>
              <p className="ln-sub ln-sub--small">This reply follows what you do in the demo at the top.</p>
            </div>
            <AuditReply rows={audit} />
          </Reveal>
        </section>

        <section className="ln-section" aria-labelledby="ln-what">
          <Reveal>
            <div className="ln-eyebrow">What it does</div>
            <h2 className="ln-h2" id="ln-what">Everything a server needs, one bot.</h2>
          </Reveal>
          <Reveal delay={60}><Capabilities /></Reveal>
          <Link className="ln-link" to="/commands">See every command <ArrowRight size={16} aria-hidden="true" /></Link>
        </section>

        <section className="ln-section" aria-labelledby="ln-music">
          <div className="ln-music">
            <Reveal className="ln-music-copy">
              <div className="ln-eyebrow">Music</div>
              <h2 className="ln-h2" id="ln-music">A record player, right in the channel.</h2>
              <p className="ln-sub">
                One live card per server, kept up to date while the song plays. Pause lifts the needle, the loop mode
                sits on its button. Say <code className="dc-code">sonder play</code> and a song, or use <code className="dc-code">/play</code>.
              </p>
              <p className="ln-sub ln-sub--small">The card's real buttons, with mock tracks. Songs you play in the demo above join this queue.</p>
            </Reveal>
            <Reveal delay={80} className="ln-music-chan">
              <div className="ln-chanbar"><span>#</span>music</div>
              <div className="cd-msg">
                <div className="cd-avatar"><img src="/logo.jpg" alt="" /></div>
                <div className="cd-main">
                  <div className="cd-who">sonder <span className="cd-app">APP</span><span className="cd-time">Today at {player.at}</span></div>
                  <MusicCard player={player} act={act} />
                  {player.ended && <button type="button" className="ln-restart" onClick={() => act('reset')}>Restart the demo queue</button>}
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <Reveal as="section" className="ln-section ln-final" aria-labelledby="ln-final">
          <img className="ln-final-cat" src="/logo.jpg" alt="" />
          <h2 className="ln-h2" id="ln-final">Add it next to your current bot.</h2>
          <p className="ln-sub">Run <code className="dc-code">/migrate scan</code>. Nothing changes until you say so.</p>
          <div className="ln-cta">
            <AddToDiscord />
            <Link className="ln-btn ln-btn--ghost" to="/commands">Browse commands <ArrowRight size={18} aria-hidden="true" /></Link>
          </div>
          <DevNote />
        </Reveal>
        <div className="ln-end" />
      </main>
    </Layout>
  )
}
