import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ShieldCheck, MessageSquareText, Music2, Trophy, Swords, Timer } from 'lucide-react'
import { Layout } from '../components/Layout'
import '../styles/landing.css'

import { INVITE_URL } from '../lib/invite'

// With no VITE_DISCORD_CLIENT_ID there is no valid invite: render an inert button (and, in dev, say why)
// rather than silently sending visitors to /dashboard.
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

function AddToDiscord() {
  if (INVITE_URL) {
    return <a className="ln-btn ln-btn--primary" href={INVITE_URL}>Add to Discord<Mascot /></a>
  }
  return (
    <>
      <span className="ln-btn ln-btn--primary" role="link" aria-disabled="true" style={{ opacity: 0.5, cursor: 'not-allowed' }}>
        Add to Discord<Mascot />
      </span>
      {import.meta.env.DEV && (
        <p role="alert" style={{ flexBasis: '100%', margin: '8px 0 0', fontSize: 13, color: 'var(--warning)' }}>
          Dev warning: VITE_DISCORD_CLIENT_ID is not set, so the invite link is disabled. Copy web/.env.example to web/.env and set it.
        </p>
      )}
    </>
  )
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

const STEPS = [
  ['Add Sonder', 'One click, and it asks only for the permissions its features need.'],
  ['Run /migrate scan', 'It finds the bot you are replacing, spots prefix clashes, and suggests where your log channels belong.'],
  ['Import your history', 'Bring warnings across from a CSV export with /import, with a dry run before anything is written.'],
  ['Talk to it', 'Say "sonder mute @alex 10m spam" in chat. It shows exactly what it will do and waits for your button press.'],
]

const ROWS = [
  [ShieldCheck, 'Moderation you can read', 'Every action lands in a case log with the moderator, the reason and the time. AI-initiated actions are tagged "via Sonder AI".'],
  [MessageSquareText, 'Chat that does things, safely', 'A parser, not the model, decides what runs. Permissions and role hierarchy are checked when it is proposed and again when you press confirm.'],
  [Music2, 'Music that starts fast', 'Query to first audio in about a second. Queue, loop, shuffle and volume work as slash or prefix commands.'],
  [Trophy, 'Leveling and economy', 'XP, rank cards, balances and shops, with the guard rails that stop negative-amount exploits.'],
  [Swords, 'Protection', 'Anti-nuke attribution from the audit log, booster-role limits and automod, all configurable per server.'],
  [Timer, 'Your data, on a timer', 'Leave and we delete your server\'s rows after 30 days. Nothing else is kept.'],
]

export function Landing() {
  const stats = useStats()
  const statItems = [[stats?.guilds, 'servers'], [stats?.members, 'members served'], [stats?.commands, 'commands']].filter(([n]) => typeof n === 'number')

  return (
    <Layout>
      <main className="ln">
        <div className="ln-hero-wrap">
          <section className="ln-hero">
            <div className="ln-glow" aria-hidden="true" />
            <HalftoneArt />
            <div>
              <span className="ln-pill"><span className="ln-dot" aria-hidden="true" />Online and answering</span>
              <h1 className="ln-h1">The bot you talk to. <span>Not the other way round.</span></h1>
              <p className="ln-lede">
                Sonder moderates, plays music, runs levels and an economy, and takes plain-language requests with a confirm
                button on anything that can hurt. Built to be a drop-in replacement for the bot you have now.
              </p>
              <div className="ln-cta">
                <AddToDiscord />
                <Link className="ln-btn ln-btn--ghost" to="/commands">Browse commands <ArrowRight size={18} aria-hidden="true" /></Link>
              </div>
              <p className="ln-fine">Free to start. No card, no vote walls.</p>
            </div>

            <div className="ln-chat" role="img" aria-label="Example: a moderator asks Sonder to mute a member and confirms with a button">
              <div className="ln-chan" aria-hidden="true"><span>#</span><b>mod-chat</b></div>
              <div className="ln-msg">
                <div className="ln-avatar" aria-hidden="true">R</div>
                <div>
                  <div className="ln-who">riri <span className="ln-time">Today at 9:41 PM</span></div>
                  <div className="ln-said">sonder mute <span className="ln-mention">@alex</span> 10m spamming links</div>
                </div>
              </div>
              <div className="ln-msg">
                <div className="ln-avatar"><img src="/logo.jpg" alt="" /></div>
                <div>
                  <div className="ln-who">sonder <span className="ln-app">APP</span> <span className="ln-time">Today at 9:41 PM</span></div>
                  <div className="ln-embed">
                    <b>Mute @alex for 10 minutes?</b>
                    Reason: spamming links. Only riri can confirm.
                    <small>Expires in 2 minutes</small>
                  </div>
                  <div className="ln-btns"><span className="ln-fake ln-fake--danger">Confirm</span><span className="ln-fake ln-fake--quiet">Cancel</span></div>
                </div>
              </div>
              <div className="ln-msg">
                <div className="ln-avatar"><img src="/logo.jpg" alt="" /></div>
                <div>
                  <div className="ln-who">sonder <span className="ln-app">APP</span> <span className="ln-time">Today at 9:42 PM</span></div>
                  <div className="ln-embed ln-embed--done">
                    <b>Muted @alex</b>
                    10 minutes, via Sonder AI, logged as case #41.
                    <small>Moderation log</small>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        {statItems.length > 1 && (
          <Reveal as="section" className="ln-section">
            <div className="ln-stats">
              {statItems.map(([n, l]) => (
                <div className="ln-stat" key={l}><div className="ln-stat-n">{fmt(n)}</div><div className="ln-stat-l">{l}</div></div>
              ))}
            </div>
          </Reveal>
        )}

        <section className="ln-section">
          <Reveal>
            <div className="ln-eyebrow">Switching</div>
            <h2 className="ln-h2">Moved in an afternoon.</h2>
            <p className="ln-sub">You should not have to rebuild a server to try a better bot.</p>
          </Reveal>
          <ol className="ln-steps">
            {STEPS.map(([t, d], i) => (
              <Reveal as="li" key={t} className="ln-step" delay={i * 60}>
                <span className="ln-step-n">{String(i + 1).padStart(2, '0')}</span>
                <h3>{t}</h3>
                <p>{d}</p>
              </Reveal>
            ))}
          </ol>
        </section>

        <section className="ln-section">
          <Reveal>
            <div className="ln-eyebrow">What it does</div>
            <h2 className="ln-h2">Everything a server needs, one bot.</h2>
          </Reveal>
          <dl className="ln-rows">
            {ROWS.map(([Icon, t, d], i) => (
              <Reveal as="div" key={t} className="ln-row" delay={i * 40}>
                <span className="ln-ico" aria-hidden="true"><Icon size={18} strokeWidth={1.75} /></span>
                <dt>{t}</dt>
                <dd>{d}</dd>
              </Reveal>
            ))}
          </dl>
          <Link className="ln-link" to="/commands">See every command <ArrowRight size={16} aria-hidden="true" /></Link>
        </section>

        <section className="ln-section">
          <Reveal className="ln-panel">
            <div>
              <div className="ln-eyebrow">Safe by construction</div>
              <h2 className="ln-h2">It asks before it acts.</h2>
              <p className="ln-sub">
                The model only writes the reply. Actions are matched by code, checked against the invoker's own permissions,
                rate limited, and recorded in an audit table you can read with /aiactions.
              </p>
            </div>
            <div className="ln-term" aria-label="Example audit output">
              <div><i>/aiactions</i></div>
              <div><b>mute</b> @alex 10m <i>executed</i></div>
              <div><b>warn</b> @sam <i>cancelled</i></div>
              <div><b>kick</b> @jo <i>rejected: role above yours</i></div>
            </div>
          </Reveal>
        </section>

        <Reveal as="section" className="ln-section ln-final">
          <h2 className="ln-h2">Try it in your server.</h2>
          <div className="ln-cta">
            <AddToDiscord />
          </div>
        </Reveal>
        <div className="ln-end" />
      </main>
    </Layout>
  )
}
