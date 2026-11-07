import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Layout } from '../components/Layout'
import { BRAND } from '../lib/brand'
import './status.css'

// Reads only the public endpoint, GET /api/public-stats (the detailed /api/stats needs a login).
// What it can prove:  200 -> API reachable AND the bot is connected to Discord (the route 503s otherwise)
//                     503 -> API reachable, bot not connected to Discord yet
//                     anything else / network error / timeout -> we cannot tell, so we say so
// The three numbers shown are exactly the fields it returns: servers, commands, uptimeSeconds.
const ENDPOINT = '/api/public-stats'
const INTERVAL = 30_000
const TIMEOUT = 8_000
const HISTORY = 20

const isStats = (d) => d && Number.isFinite(d.servers) && Number.isFinite(d.commands) && Number.isFinite(d.uptimeSeconds)

async function check() {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT)
  const started = performance.now()
  try {
    const r = await fetch(ENDPOINT, { signal: ctrl.signal, cache: 'no-store', headers: { accept: 'application/json' } })
    const ms = Math.round(performance.now() - started)
    // the bot's own 503 says {"error":"starting"}; a 503 from a proxy in front of it means something else
    if (r.status === 503) {
      const body = await r.json().catch(() => null)
      if (body?.error === 'starting') return { state: 'starting', ms }
    }
    if (!r.ok) return { state: 'unreachable', reason: `The API answered with HTTP ${r.status}.`, ms }
    const d = await r.json().catch(() => null)
    if (!isStats(d)) return { state: 'unreachable', reason: 'The API answered, but not with status data.', ms }
    return { state: 'online', data: d, ms }
  } catch (e) {
    return { state: 'unreachable', reason: e.name === 'AbortError' ? `No answer within ${TIMEOUT / 1000} seconds.` : 'The request did not reach the API.' }
  } finally {
    clearTimeout(t)
  }
}

const COPY = {
  checking: { title: 'Checking', line: 'Asking the bot for its status.' },
  online: { title: 'Online', line: 'Connected to Discord and answering requests.' },
  starting: { title: 'Starting up', line: 'The API is up, but the bot has not connected to Discord yet.' },
  unreachable: { title: 'Unreachable', line: 'We could not get a status from the bot. It may be down, or only this page cannot reach it.' },
}

function formatUptime(s) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  return `${Math.max(m, 0)}m`
}

function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`
}

const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

// re-render on a timer so "12s ago" stays true; stops while the tab is hidden
function useNow(every = 1000, active = true) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(t)
  }, [every, active])
  return now
}

function useVisible() {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden)
  useEffect(() => {
    const on = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return visible
}

export function Status() {
  const [state, setState] = useState('checking')
  const [reason, setReason] = useState('')
  const [data, setData] = useState(null)          // last good reading, kept (and labelled) when a later check fails
  const [dataAt, setDataAt] = useState(0)
  const [checkedAt, setCheckedAt] = useState(0)
  const [nextAt, setNextAt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState([])      // checks made by this tab only
  const visible = useVisible()
  const now = useNow(1000, visible)
  const inFlight = useRef(false)
  const timer = useRef(0)
  const live = useRef(true)

  const run = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    clearTimeout(timer.current)
    const res = await check()
    if (!live.current) return
    const at = Date.now()
    inFlight.current = false
    setBusy(false)
    setState(res.state)
    setReason(res.reason || '')
    setCheckedAt(at)
    if (res.data) { setData(res.data); setDataAt(at) }
    setHistory((h) => [...h, { at, state: res.state, ms: res.ms }].slice(-HISTORY))
    if (!document.hidden) {
      setNextAt(at + INTERVAL)
      timer.current = setTimeout(run, INTERVAL)
    } else {
      setNextAt(0)
    }
  }, [])

  useEffect(() => {
    live.current = true
    run()
    return () => { live.current = false; clearTimeout(timer.current) }
  }, [run])

  // pause when hidden; on return, check at once if the last check is stale, else resume the countdown
  useEffect(() => {
    if (!checkedAt) return
    if (!visible) { clearTimeout(timer.current); setNextAt(0); return }
    if (inFlight.current) return
    const due = checkedAt + INTERVAL - Date.now()
    if (due <= 0) run()
    else { clearTimeout(timer.current); setNextAt(checkedAt + INTERVAL); timer.current = setTimeout(run, due) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  const copy = COPY[state]
  const stale = data && state !== 'online'
  const left = nextAt ? Math.max(0, Math.ceil((nextAt - now) / 1000)) : null
  const ok = history.filter((h) => h.state === 'online').length
  // fixed once per countdown, so the CSS bar starts at the right point without restarting every tick
  const progressDelay = useMemo(() => (nextAt ? -(Date.now() - (nextAt - INTERVAL)) : 0), [nextAt])

  return (
    <Layout>
      <div className="st">
        <header className="st-top">
          <p className="st-eyebrow">Status</p>
          <h1 className="st-h1">Is {BRAND} up?</h1>
          <p className="st-lede">Live from the bot's public status endpoint. This page shows only what that endpoint reports, nothing estimated.</p>
        </header>

        <section className={`st-card is-${state}`} aria-labelledby="st-title" aria-busy={busy}>
          <div className="st-dots" aria-hidden="true" />
          <div className="st-card-main">
            <span className="st-beacon" aria-hidden="true"><span /></span>
            <div className="st-card-text">
              <h2 id="st-title" className="st-title" aria-live="polite">{copy.title}</h2>
              <p className="st-line">{copy.line}</p>
              {state === 'unreachable' && reason && <p className="st-reason">{reason}</p>}
            </div>
          </div>

          <div className="st-bar">
            <div className="st-checked">
              {checkedAt
                ? <>Checked <time dateTime={new Date(checkedAt).toISOString()} title={clock(checkedAt)}>{ago(now - checkedAt)}</time></>
                : 'First check running'}
              <span className="st-sep" aria-hidden="true" />
              <span className="st-auto">
                {busy ? 'Checking now' : !visible ? 'Auto-refresh paused while this tab is hidden' : left !== null ? `Next check in ${left}s` : 'Auto-refresh every 30s'}
              </span>
            </div>
            <button type="button" className="st-refresh" onClick={run} disabled={busy}>
              <RefreshCw size={15} aria-hidden="true" className={busy ? 'is-spinning' : ''} />
              {busy ? 'Checking' : 'Refresh'}
            </button>
          </div>
          {nextAt > 0 && !busy && (
            <div className="st-progress" aria-hidden="true">
              <span key={nextAt} style={{ animationDuration: `${INTERVAL}ms`, animationDelay: `${progressDelay}ms` }} />
            </div>
          )}
        </section>

        <section className="st-metrics" aria-label="Reported numbers">
          {stale && (
            <p className="st-stale">Last good reading from {clock(dataAt)}. It may be out of date.</p>
          )}
          <dl className={`st-grid ${stale ? 'is-stale' : ''}`}>
            <div className="st-metric">
              <dt>Servers</dt>
              <dd>{data ? data.servers.toLocaleString() : <span className="st-none">No data</span>}</dd>
              <p>Guilds the bot is in</p>
            </div>
            <div className="st-metric">
              <dt>Commands loaded</dt>
              <dd>{data ? data.commands.toLocaleString() : <span className="st-none">No data</span>}</dd>
              <p>Slash and prefix, in memory</p>
            </div>
            <div className="st-metric">
              <dt>Process uptime</dt>
              <dd>{data ? formatUptime(data.uptimeSeconds) : <span className="st-none">No data</span>}</dd>
              <p>Since the last restart</p>
            </div>
          </dl>
          <p className="st-fine">The endpoint caches for up to 30 seconds, so these can trail reality by that much.</p>
        </section>

        <section className="st-checks" aria-labelledby="st-checks-title">
          <div className="st-checks-head">
            <h2 id="st-checks-title">Checks from this tab</h2>
            <p>{history.length ? `${ok} of ${history.length} online` : 'None yet'}</p>
          </div>
          <ol className="st-ticks">
            {history.map((h) => (
              <li key={h.at} className={`st-tick is-${h.state}`} title={`${clock(h.at)}: ${COPY[h.state].title}${h.ms !== undefined ? `, ${h.ms} ms` : ''}`}>
                <span className="st-sr">{clock(h.at)}: {COPY[h.state].title}</span>
              </li>
            ))}
            {Array.from({ length: Math.max(0, HISTORY - history.length) }, (_, i) => <li key={`e${i}`} className="st-tick is-empty" aria-hidden="true" />)}
          </ol>
          <p className="st-fine">Only checks made while you have this page open. There is no stored history or uptime percentage yet, so we do not show one.</p>
        </section>

        <section className="st-scope" aria-labelledby="st-scope-title">
          <h2 id="st-scope-title">What this page can see</h2>
          <ul>
            <li><b>Discord connection.</b> The endpoint only answers when the bot is connected, so "Online" means connected.</li>
            <li><b>Web API.</b> If the request fails or times out, the API is unreachable from your browser.</li>
            <li><b>Not covered.</b> Music playback, the database and AI replies are not reported publicly, so they are not shown here.</li>
          </ul>
        </section>
      </div>
    </Layout>
  )
}
