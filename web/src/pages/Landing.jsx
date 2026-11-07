import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Layout } from '../components/Layout'
import { ChatDemo } from '../components/landing/ChatDemo'
import { MusicCard, usePlayer } from '../components/landing/MusicPlayer'
import { Switcher } from '../components/landing/Switcher'
import { TicketsMock, LoggingMock, LoggingSettings, LeaderboardMock, VoiceMock, LastfmMock, AntinukeMock, AntinukeAlert } from '../components/landing/Modules'
import { Embed, BotIcon, clock } from '../components/landing/Discord'
import '../styles/landing.css'

import { INVITE_URL } from '../lib/invite'
import { BRAND } from '../lib/brand'

function Mascot() {
  return <span className="ln-mascot" aria-hidden="true"><img src="/logo.jpg" alt="" /></span>
}

// Halftone dot-matrix art, generated (no image fetch): dot radius follows a smooth field of overlapping blobs,
// so it reads as a printed halftone. Deterministic, so it renders the same every time. It sits behind the chat
// card, centred on it: the blobs ring the card's corners so dots show in the margin around it, and the CSS mask
// fades the field out before the hero card's edge. Built once at module load, not on every render.
const HCOLS = 84, HROWS = 72
const BLOBS = [[0.86, 0.06, 0.30, 1], [0.92, 0.9, 0.28, 0.9], [0.1, 0.94, 0.3, 0.85], [0.03, 0.4, 0.2, 0.55], [0.3, 0.02, 0.2, 0.5], [0.5, 0.5, 0.6, 0.3]]
const DOTS = (() => {
  const dots = []
  for (let y = 0; y < HROWS; y++) {
    for (let x = 0; x < HCOLS; x++) {
      const u = x / (HCOLS - 1), v = y / (HROWS - 1)
      let f = 0
      for (const [bx, by, br, bw] of BLOBS) {
        const d = Math.hypot((u - bx) * (HCOLS / HROWS), v - by) / br
        f += bw * Math.exp(-d * d * 1.6)
      }
      f += 0.08 * Math.sin(u * 17 + v * 9) * f
      const r = Math.min(0.5, Math.max(0, (f - 0.16) * 0.55))
      if (r > 0.06) dots.push(<circle key={x + '-' + y} cx={x + 0.5} cy={y + 0.5} r={r} />)
    }
  }
  return dots
})()
function HalftoneArt() {
  return (
    <svg className="ln-halftone" viewBox={`0 0 ${HCOLS} ${HROWS}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      {DOTS}
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

// One full-width band per module: number, eyebrow, headline, a line of copy, then the mock. Sides alternate.
function Mod({ n, id, eyebrow, title, text, list, side, children }) {
  return (
    <section className="ln-mod" aria-labelledby={id}>
      <div className="ln-mod-in">
        <Reveal className="ln-mod-copy">
          <div className="ln-eyebrow"><span className="ln-mod-n">{n}</span>{eyebrow}</div>
          <h2 className="ln-h2" id={id}>{title}</h2>
          <p className="ln-sub">{text}</p>
          {list && <ul className="ln-mod-list">{list.map((x, i) => <li key={i}><span>{x}</span></li>)}</ul>}
          {side && <div className="ln-mod-side">{side}</div>}
        </Reveal>
        <Reveal delay={80} className="ln-mod-mock">{children}</Reveal>
      </div>
    </section>
  )
}

// Proof strip: checkable facts about the bot, not usage numbers (pre-launch). 85 / 170 come from commands.json,
// which scripts/gen-commands.mjs builds from src/commands; the invite has no Administrator bit (lib/invite.js).
const PROOF = [
  ['170', 'commands, 85 of them slash'],
  ['No', 'Administrator permission asked for'],
  ['30 days', 'after removal, your server data is deleted'],
  ['Every', 'chat action waits for a moderator\'s button'],
  ['CSV', 'import for warnings from your old bot'],
  ['One', 'live music card per server'],
]
function Proof() {
  const row = (hidden) => PROOF.map(([b, t]) => <li key={(hidden ? 'h' : '') + t} aria-hidden={hidden || undefined}><b>{b}</b> {t}</li>)
  return <div className="ln-proof"><ul aria-label={`What ${BRAND} does`}>{row(false)}{row(true)}</ul></div>
}

// /aiactions as the bot sends it (src/commands/config/aiactions.js): an ephemeral response() embed
const STATUS = { executed: 'done', cancelled: 'cancelled', expired: 'expired', rejected: 'refused', failed: 'failed', proposed: 'waiting' }
function AuditReply({ rows }) {
  return (
    <div className="ln-audit">
      <div className="sw-cmdline"><span className="cd-ravatar" aria-hidden="true">M</span><b>Moderator</b><span>used</span><span className="dc-cmd">/aiactions</span></div>
      <div className="sw-bot"><BotIcon size={32} /><div aria-live="polite">
        <div className="cd-who">{BRAND} <span className="cd-app">APP</span><span className="cd-time">Today at {clock()}</span></div>
        {rows.length === 0
          ? <Embed color="muted" at={clock()}>Nobody has asked {BRAND} to do anything in chat yet.</Embed>
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
    <Layout wide>
      <main className="ln">
        <header className="ln-top">
          <div className="ln-aura" aria-hidden="true" />
          <figure className="ln-cat"><img src="/logo.jpg" alt={`${BRAND}, a white cat`} width="136" height="136" /></figure>
          <h1 className="ln-h1" id="ln-h1">Tell it what to do. <span>It asks before it acts.</span></h1>
          <p className="ln-lede">
            {BRAND} runs moderation, music, levels and logging for your Discord server. Ask in plain words; nothing that can hurt runs until a moderator presses the button.
          </p>
          <div className="ln-cta">
            <AddToDiscord />
            <Link className="ln-textlink" to="/commands">Browse commands <ArrowRight size={17} aria-hidden="true" /></Link>
          </div>
          <DevNote />
          <Proof />
        </header>

        <div className="ln-stage-wrap">
          <section className="ln-stage" aria-labelledby="ln-try">
            <div className="ln-stage-copy">
              <div className="ln-eyebrow">Live demo</div>
              <h2 className="ln-h2" id="ln-try">Say it. Check it. Press it.</h2>
              <p className="ln-sub">You are a moderator in this channel. Ask {BRAND} to mute someone: it shows the exact command, who can confirm and when the offer runs out, then waits for your button.</p>
              <ul className="ln-pills" aria-label={`Free in ${BRAND} today`}>{INCLUDED.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
            <div className="ln-hero-demo">
              <div className="ln-glow" aria-hidden="true" />
              <HalftoneArt />
              <ChatDemo player={player} act={act} setAudit={setAudit} prefill={prefill} />
            </div>
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
            <p className="ln-sub">Keep your old bot running. {BRAND} finds it, avoids its prefix, reuses its channels and imports your warnings. Turn the old one off when you are ready.</p>
          </Reveal>
          <Reveal delay={60}>
            <Switcher onTry={() => setPrefill({ text: `${BRAND} mute @member 10m for spamming links`, n: Date.now() })} />
          </Reveal>
        </section>

        <div className="ln-mods">
          <Mod n="01" id="ln-safe" eyebrow="Moderation + chat actions" title="It asks before it acts."
            text={<>The model only writes replies. Mute, unmute, warn and kick are matched by code, checked against the asker's own permissions and role when proposed and again on the button press, and written to an audit table you read with <code className="dc-code">/aiactions</code>.</>}
            list={['This reply follows what you do in the demo above.', 'Every mod action posts to your mod log with the moderator and the reason.']}>
            <AuditReply rows={audit} />
          </Mod>
          <Mod n="02" id="ln-tickets" eyebrow="Tickets" title="A button, a private channel, a transcript."
            text="Post the panel with /ticket setup. Each ticket is a private channel that only the opener and your support role can see."
            list={[<>Claim it, then close it with the button</>, <>On close, a <code>.txt</code> transcript goes to your ticket log channel</>, <>Set a category with <code>/ticket category</code></>]}>
            <TicketsMock />
          </Mod>
          <Mod n="03" id="ln-logs" eyebrow="Logging" title="See what was deleted, edited and who joined voice."
            text={<>Create a private <code className="dc-code">#mofu-logs</code> channel with <code className="dc-code">/logging create</code>, and switch each kind on or off with <code className="dc-code">/logging toggle</code>.</>}
            side={<LoggingSettings />}>
            <LoggingMock />
          </Mod>
          <Mod n="04" id="ln-levels" eyebrow="Levels" title="XP for talking, and for time in voice."
            text="Ranks, level-up messages, role rewards and XP multipliers. The leaderboard shows the top ten and where you stand."
            list={[<><code>/rank</code>, <code>/xpleaderboard</code>, <code>/levelrole</code></>, 'No-XP channels and roles, voice XP, multipliers']}>
            <LeaderboardMock />
          </Mod>
          <Mod n="05" id="ln-voice" eyebrow="VoiceMaster" title="Join one channel, get your own."
            text="Members join the create channel and get a voice channel of their own, which is deleted when it empties. If the owner leaves, the next person inside takes over."
            list={[<>Owners run <code>/voice</code> lock, unlock, rename, limit, permit, reject, claim and info</>]}>
            <VoiceMock />
          </Mod>
          <Mod n="06" id="ln-music" eyebrow="Music" title="A record player, right in the channel."
            text={<>One live card per server, kept up to date while the song plays. Pause lifts the needle, the loop mode sits on its button. Say <code className="dc-code">{BRAND} play</code> and a song, or use <code className="dc-code">/play</code>.</>}
            list={["The card's real buttons, with mock tracks.", 'Songs you play in the demo above join this queue.']}>
            <div className="ln-music-chan">
              <div className="ln-chanbar"><span>#</span>music</div>
              <div className="cd-msg">
                <div className="cd-avatar"><img src="/logo.jpg" alt="" /></div>
                <div className="cd-main">
                  <div className="cd-who">{BRAND} <span className="cd-app">APP</span><span className="cd-time">Today at {player.at}</span></div>
                  <MusicCard player={player} act={act} />
                  {player.ended && <button type="button" className="ln-restart" onClick={() => act('reset')}>Restart the demo queue</button>}
                </div>
              </div>
            </div>
          </Mod>
          <Mod n="07" id="ln-fm" eyebrow="Last.fm" title="What everyone is listening to."
            text={<>Link your account once with <code className="dc-code">;fm set</code>, then <code className="dc-code">;fm</code> shows the track you are playing now, or the last one you played.</>}>
            <LastfmMock />
          </Mod>
          <Mod n="08" id="ln-nuke" eyebrow="Antinuke" title="Catches mass deletes, bans and kicks."
            text="If anyone but the owner or the whitelist passes a limit inside 10 seconds, they are banned, their roles are stripped, and the bot tries to undo what they did. Set each limit from 2 to 10."
            side={<AntinukeAlert />}>
            <AntinukeMock />
          </Mod>
        </div>

        <div className="ln-section ln-section--tight">
          <Link className="ln-link" to="/commands">See all 170 commands <ArrowRight size={16} aria-hidden="true" /></Link>
          <p className="ln-sub ln-sub--small">All of the above is free. <Link to="/pricing">See pricing</Link>.</p>
        </div>

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
