import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Plus } from 'lucide-react'
import { Layout } from '../components/Layout'
import '../styles/landing.css'

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID
const INVITE = CLIENT_ID
  ? `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&permissions=1375332592887&scope=bot+applications.commands`
  : '/dashboard'

function Reveal({ children, delay = 0, as: Tag = 'div', className = '', ...rest }) {
  const ref = useRef(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setSeen(true); return }
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
  ['Moderation you can read', 'Every action lands in a case log with the moderator, the reason and the time. AI-initiated actions are tagged "via Sonder AI".'],
  ['Chat that does things, safely', 'A parser, not the model, decides what runs. Permissions and role hierarchy are checked when it is proposed and again when you press confirm.'],
  ['Music that starts fast', 'Query to first audio in about a second. Queue, loop, shuffle and volume work as slash or prefix commands.'],
  ['Leveling and economy', 'XP, rank cards, balances and shops, with the guard rails that stop negative-amount exploits.'],
  ['Protection', 'Anti-nuke attribution from the audit log, booster-role limits and automod, all configurable per server.'],
  ['Your data, on a timer', 'Leave and we delete your server\'s rows after 30 days. Nothing else is kept.'],
]

export function Landing() {
  const stats = useStats()

  return (
    <Layout>
      <main className="ln">
        <div className="ln-hero-wrap">
          <section className="ln-hero">
            <div>
              <span className="ln-pill"><span className="ln-dot" aria-hidden="true" />Online and answering</span>
              <h1 className="ln-h1">The bot you talk to. <span>Not the other way round.</span></h1>
              <p className="ln-lede">
                Sonder moderates, plays music, runs levels and an economy, and takes plain-language requests with a confirm
                button on anything that can hurt. Built to be a drop-in replacement for the bot you have now.
              </p>
              <div className="ln-cta">
                <a className="ln-btn ln-btn--primary" href={INVITE}><Plus size={18} aria-hidden="true" />Add to Discord</a>
                <Link className="ln-btn ln-btn--ghost" to="/commands">Browse commands <ArrowRight size={18} aria-hidden="true" /></Link>
              </div>
              <p className="ln-fine">Free to start. No card, no vote walls.</p>
            </div>

            <div className="ln-chat" role="img" aria-label="Example: a moderator asks Sonder to mute a member and confirms with a button">
              <div className="ln-msg">
                <div className="ln-avatar" aria-hidden="true">R</div>
                <div>
                  <div className="ln-who">riri</div>
                  <div className="ln-said">sonder mute <span className="ln-mention">@alex</span> 10m spamming links</div>
                </div>
              </div>
              <div className="ln-msg">
                <div className="ln-avatar"><img src="/logo.jpg" alt="" /></div>
                <div>
                  <div className="ln-who">sonder <span className="ln-app">APP</span></div>
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
                  <div className="ln-who">sonder <span className="ln-app">APP</span></div>
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

        <Reveal as="section" className="ln-section">
          <div className="ln-stats">
            <div className="ln-stat"><div className="ln-stat-n">{fmt(stats?.guilds)}</div><div className="ln-stat-l">servers</div></div>
            <div className="ln-stat"><div className="ln-stat-n">{fmt(stats?.members)}</div><div className="ln-stat-l">members served</div></div>
            <div className="ln-stat"><div className="ln-stat-n">{fmt(stats?.commands)}</div><div className="ln-stat-l">commands</div></div>
          </div>
        </Reveal>

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
            {ROWS.map(([t, d], i) => (
              <Reveal as="div" key={t} className="ln-row" delay={i * 40}>
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
            <a className="ln-btn ln-btn--primary" href={INVITE}><Plus size={18} aria-hidden="true" />Add to Discord</a>
          </div>
        </Reveal>
        <div className="ln-end" />
      </main>
    </Layout>
  )
}
