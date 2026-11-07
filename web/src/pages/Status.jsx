import { useState, useEffect } from 'react'
import { Activity, Server, Cpu, Clock, CheckCircle, AlertCircle, Wifi } from 'lucide-react'
import { Layout } from '../components/Layout'

// state: 'ok' | 'down' | 'unknown' (we have no signal for it)
function StatusDot({ state }) {
  const color = state === 'ok' ? 'var(--success)' : state === 'down' ? 'var(--error)' : 'var(--fg-4)'
  return (
    <div aria-hidden="true" style={{
      width: 8, height: 8, borderRadius: '50%', background: color,
      boxShadow: state === 'unknown' ? 'none' : `0 0 8px color-mix(in oklab, ${color} 40%, transparent)`,
    }} />
  )
}

function MetricCard({ icon: Icon, label, value, sub, state }) {
  return (
    <div style={{
      padding: 'var(--space-5)', borderRadius: 'var(--radius-xl)',
      border: '1px solid var(--border-default)',
      background: 'var(--surface-1)', boxShadow: 'var(--shadow-xs)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Icon size={13} style={{ color: 'var(--fg-3)' }} />
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-3)', fontWeight: 'var(--weight-medium)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)' }}>{label}</span>
        </div>
        {state !== undefined && <StatusDot state={state} />}
      </div>
      <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)', color: 'var(--fg-1)', fontFamily: 'var(--font-mono)', letterSpacing: 'var(--tracking-tight)', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-3)', marginTop: 'var(--space-1-5)' }}>{sub}</div>}
    </div>
  )
}

export function Status() {
  // Only the public, unauthenticated endpoint: /api/stats needs a login and would make every anonymous visit read "down".
  // 'Operational' is shown only for what this response proves; the rest says "Not reported".
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)   // null | 'starting' | 'unreachable'

  useEffect(() => {
    let live = true
    const load = () => fetch('/api/public-stats')
      .then(r => {
        if (r.status === 503) throw new Error('starting')
        if (!r.ok) throw new Error('unreachable')
        return r.json()
      })
      .then(d => { if (live) { setData(d); setError(null) } })
      .catch(e => { if (live) { setData(null); setError(e.message === 'starting' ? 'starting' : 'unreachable') } })
    load()
    const t = setInterval(load, 30000)
    return () => { live = false; clearInterval(t) }
  }, [])

  const operational = !!data
  const failed = !!error

  return (
    <Layout>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 'var(--space-10) var(--space-6) var(--space-20)' }}>
        {/* Header */}
        <div style={{ marginBottom: 'var(--space-10)', animation: 'fade-up 0.4s var(--ease-default) both' }}>
          <h1 style={{
            fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)',
            fontWeight: 'var(--weight-bold)', color: 'var(--fg-1)',
            letterSpacing: 'var(--tracking-tight)', marginBottom: 'var(--space-2)',
          }}>
            Status
          </h1>
          <p style={{ fontSize: 'var(--text-base)', color: 'var(--fg-3)' }}>
            Real-time bot health and performance metrics.
          </p>
        </div>

        {/* Overall status banner */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
          padding: 'var(--space-4) var(--space-5)', borderRadius: 'var(--radius-xl)',
          border: `1px solid ${operational ? 'var(--success-border)' : failed ? 'var(--error-border)' : 'var(--border-default)'}`,
          background: operational ? 'var(--success-subtle)' : failed ? 'var(--error-subtle)' : 'var(--surface-1)',
          marginBottom: 'var(--space-6)',
          animation: 'fade-up 0.4s var(--ease-default) 0.06s both',
        }}>
          {operational ? (
            <CheckCircle size={18} style={{ color: 'var(--success)' }} />
          ) : failed ? (
            <AlertCircle size={18} style={{ color: 'var(--error)' }} />
          ) : (
            <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--border-default)', borderTopColor: 'var(--accent)', animation: 'spin 0.7s linear infinite' }} />
          )}
          <div>
            <div style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-1)' }}>
              {operational ? 'Bot is online' : error === 'starting' ? 'Starting up' : failed ? 'Service Unavailable' : 'Checking...'}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-3)' }}>
              {operational ? 'Connected to Discord and answering requests' : error === 'starting' ? 'The bot is not connected to Discord yet' : failed ? 'Cannot reach the bot API' : 'Fetching status...'}
            </div>
          </div>
        </div>

        {/* Metrics */}
        {data && (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 'var(--space-3)',
            animation: 'fade-up 0.5s var(--ease-default) 0.12s both',
          }}>
            <MetricCard icon={Clock} label="Uptime" value={formatUptime(data.uptimeSeconds)} sub="Since last restart" state="ok" />
            <MetricCard icon={Server} label="Servers" value={data.servers} sub="Active guilds" />
            <MetricCard icon={Cpu} label="Commands" value={data.commands} sub="Loaded and registered" />
          </div>
        )}

        {/* Services */}
        <div style={{
          marginTop: 'var(--space-6)',
          borderRadius: 'var(--radius-xl)',
          border: '1px solid var(--border-default)',
          background: 'var(--surface-1)',
          overflow: 'hidden', boxShadow: 'var(--shadow-xs)',
          animation: 'fade-up 0.5s var(--ease-default) 0.18s both',
        }}>
          <div style={{
            fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-2)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
            padding: 'var(--space-4) var(--space-5) var(--space-3)',
            borderBottom: '1px solid var(--border-subtle)',
          }}>Services</div>
          {[
            { name: 'Discord Gateway', desc: 'WebSocket connection to Discord', state: operational ? 'ok' : failed ? 'down' : 'unknown' },
            { name: 'Command Handler', desc: 'Slash and prefix commands', state: operational && data.commands > 0 ? 'ok' : failed ? 'down' : 'unknown' },
            { name: 'Dashboard API', desc: 'REST API for web dashboard', state: operational ? 'ok' : failed && error !== 'starting' ? 'down' : 'unknown' },
            { name: 'Music Player', desc: 'Audio playback engine', state: 'unknown' },
            { name: 'Database', desc: 'SQLite persistence layer', state: 'unknown' },
            { name: 'AI (Groq)', desc: 'Language model inference', state: 'unknown' },
          ].map((svc, i) => (
            <div key={svc.name} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: 'var(--space-3) var(--space-5)',
              borderBottom: i < 5 ? '1px solid var(--border-subtle)' : 'none',
            }}>
              <div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-1)', fontWeight: 'var(--weight-medium)' }}>{svc.name}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-3)' }}>{svc.desc}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <span style={{ fontSize: 'var(--text-xs)', color: svc.state === 'ok' ? 'var(--success)' : svc.state === 'down' ? 'var(--error)' : 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                  {svc.state === 'ok' ? 'Operational' : svc.state === 'down' ? 'Down' : 'Not reported'}
                </span>
                <StatusDot state={svc.state} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  )
}

function formatUptime(seconds) {
  if (!seconds) return '0m'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
