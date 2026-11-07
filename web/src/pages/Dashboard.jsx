import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { LogIn, Users, Server, Terminal, Activity, ArrowUpRight, Sparkles } from 'lucide-react'
import { Layout } from '../components/Layout'
import { api } from '../lib/api'
import { useToken, setToken, clearToken, loginUrl as buildLoginUrl } from '../lib/auth'

const handledCodes = new Set()

const LOADING_PHRASES = [
  'listening..', 'reading the room..', 'taking it all in..',
  'piecing it together..', 'tuning in..', 'picking up on that..',
  'catching the vibe..', 'one moment, thinking..',
]

function getGreeting(name) {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return `morning, ${name}. let's see what's going on.`
  if (h >= 12 && h < 17) return `afternoon, ${name}. here's your servers.`
  if (h >= 17 && h < 21) return `evening, ${name}. catching up?`
  return `late one, ${name}. let's take a look.`
}

function StatCard({ icon: Icon, label, value, accent }) {
  // accent is a CSS colour token (var(--x)); tint it with color-mix, since appending hex alpha to var() is invalid CSS
  const tint = `color-mix(in oklab, ${accent} 12%, transparent)`
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: 'var(--space-5)', borderRadius: 'var(--radius-xl)',
        border: `1px solid ${hovered ? 'var(--border-strong)' : 'var(--border-default)'}`,
        background: 'var(--surface-1)',
        position: 'relative', overflow: 'hidden',
        transition: 'border-color 160ms var(--ease-default), transform 200ms var(--ease-default)',
        transform: hovered ? 'translateY(-1px)' : 'none',
        boxShadow: 'var(--shadow-xs)',
      }}
    >
      <div style={{
        position: 'absolute', top: -30, right: -30, width: 100, height: 100,
        background: `radial-gradient(circle, ${tint} 0%, transparent 70%)`,
        borderRadius: '50%', transition: 'opacity 200ms', opacity: hovered ? 1 : 0.4,
      }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <Icon size={13} style={{ color: accent, opacity: 0.9 }} />
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-3)', fontWeight: 'var(--weight-medium)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)' }}>{label}</span>
      </div>
      <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)', color: 'var(--fg-1)', fontFamily: 'var(--font-mono)', letterSpacing: 'var(--tracking-tight)', lineHeight: 1 }}>{value}</div>
    </div>
  )
}

function GuildCard({ guild, onClick, index }) {
  const [hovered, setHovered] = useState(false)
  const isFeature = index === 0

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Manage ${guild.name}`}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      className={isFeature ? 'dash-span-2' : undefined}
      style={{
        padding: isFeature ? 'var(--space-6)' : 'var(--space-4)',
        borderRadius: 'var(--radius-xl)', cursor: 'pointer',
        border: `1px solid ${hovered ? 'var(--border-accent)' : 'var(--border-default)'}`,
        background: hovered ? 'var(--surface-selected)' : 'var(--surface-1)',
        transition: 'all 180ms var(--ease-default)',
        transform: hovered ? 'translateY(-2px)' : 'none',
        boxShadow: hovered ? 'var(--shadow-accent)' : 'var(--shadow-xs)',
        gridColumn: isFeature ? 'span 2' : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        {guild.icon ? (
          <img
            src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`}
            alt=""
            style={{
              width: isFeature ? 48 : 38, height: isFeature ? 48 : 38,
              borderRadius: 'var(--radius-lg)', flexShrink: 0,
              border: '1px solid var(--border-subtle)',
            }}
          />
        ) : (
          <div style={{
            width: isFeature ? 48 : 38, height: isFeature ? 48 : 38,
            borderRadius: 'var(--radius-lg)',
            background: 'var(--accent-subtle)',
            border: '1px solid var(--border-accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Server size={isFeature ? 20 : 16} style={{ color: 'var(--accent)' }} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: isFeature ? 'var(--text-md)' : 'var(--text-base)',
            fontWeight: 'var(--weight-semibold)', color: 'var(--fg-1)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            fontFamily: isFeature ? 'var(--font-display)' : undefined,
          }}>{guild.name}</div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-3)', marginTop: 2 }}>
            {isFeature ? 'Most recently active' : 'Manage'}
          </div>
        </div>
        <ArrowUpRight
          size={15}
          style={{
            color: hovered ? 'var(--accent)' : 'var(--fg-4)',
            transition: 'color 120ms, transform 200ms var(--ease-spring)',
            transform: hovered ? 'translate(1px, -1px)' : 'none',
          }}
        />
      </div>
    </div>
  )
}

export function Dashboard() {
  const token = useToken()
  const [authError, setAuthError] = useState(null)
  const [user, setUser] = useState(null)
  const [guilds, setGuilds] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  // OAuth callback: runs once per ?code=. Every path ends in setLoading(false) (or a navigate that re-runs the effect).
  useEffect(() => {
    const code = searchParams.get('code')
    if (code) {
      // StrictMode runs effects twice in dev, and the OAuth state/code are single-use: handle each code once.
      if (handledCodes.has(code)) return
      handledCodes.add(code)
      const finish = (err) => {
        if (err) setAuthError(err)
        setLoading(false)
        navigate('/dashboard', { replace: true })
      }
      // The server issued the state in a signed cookie on /api/auth/login and checks it here.
      setLoading(true)
      ;(async () => {
        try {
          const r = await fetch('/api/auth/callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, state: searchParams.get('state') }),
          })
          const data = await r.json().catch(() => null)
          if (r.ok && data && data.access_token) {
            setToken(data.access_token)
            finish(null)
          } else {
            finish((data && data.error) || `Sign-in failed (${r.status}). Please try again.`)
          }
        } catch {
          finish("Couldn't reach the server to finish signing in. Please try again.")
        }
      })()
      return
    }

    if (!token) { setUser(null); setLoading(false); return }

    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const [u, g, s] = await Promise.all([
          api('/user', token, { noRedirect: true }),
          api('/guilds', token, { noRedirect: true }),
          api('/stats', token, { noRedirect: true }),
        ])
        if (cancelled) return
        if (u.status === 401) { clearToken(); return }   // only a 401 means the token is bad
        if (!u.ok) { setAuthError(u.error); return }
        setAuthError(null)
        setUser(u.data)
        setGuilds(g.ok ? g.data || [] : [])
        setStats(s.ok ? s.data : null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [token, searchParams])

  const loadingPhrase = useMemo(() => LOADING_PHRASES[Math.floor(Math.random() * LOADING_PHRASES.length)], [])

  if (loading) {
    return (
      <Layout>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-4)' }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              border: '2px solid var(--border-default)', borderTopColor: 'var(--accent)',
              animation: 'spin 0.7s linear infinite',
            }} />
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-3)', fontFamily: 'var(--font-body)', animation: 'pulse 1.8s ease infinite' }}>{loadingPhrase}</span>
          </div>
        </div>
      </Layout>
    )
  }

  if (!token || !user) {
    const loginUrl = buildLoginUrl()
    return (
      <Layout>
        <style>{`
          @keyframes drift { 0%, 100% { transform: translateY(0) rotate(0deg) } 50% { transform: translateY(-10px) rotate(0.5deg) } }
          @keyframes reveal { from { opacity: 0; transform: translateY(20px) } to { opacity: 1; transform: translateY(0) } }
        `}</style>

        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '70vh', padding: 'var(--space-10) var(--space-6)', textAlign: 'center',
        }}>
          <div style={{ animation: 'drift 5s ease-in-out infinite', marginBottom: 'var(--space-8)' }}>
            <img src="/logo.jpg" alt="" style={{
              width: 72, height: 72, borderRadius: 'var(--radius-2xl)', objectFit: 'cover',
              boxShadow: 'var(--shadow-accent-lg)',
              border: '1px solid var(--border-accent)',
            }} />
          </div>

          <div style={{ animation: 'reveal 0.6s var(--ease-default) 0.1s both' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1-5)',
              background: 'var(--accent-subtle)', border: '1px solid var(--border-accent)',
              borderRadius: 'var(--radius-full)', padding: '4px 11px', marginBottom: 'var(--space-5)',
            }}>
              <Sparkles size={11} style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--accent)' }}>Dashboard</span>
            </div>
          </div>

          <h1 style={{
            fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)',
            fontWeight: 'var(--weight-bold)', color: 'var(--fg-1)',
            letterSpacing: 'var(--tracking-tight)', marginBottom: 'var(--space-2)',
            animation: 'reveal 0.6s var(--ease-default) 0.15s both',
          }}>
            Manage your servers
          </h1>
          <p style={{
            fontSize: 'var(--text-md)', color: 'var(--fg-3)', marginBottom: 'var(--space-8)',
            animation: 'reveal 0.6s var(--ease-default) 0.2s both',
          }}>
            Sign in with Discord to get started
          </p>
          {authError && (
            <p role="alert" style={{ fontSize: 'var(--text-sm)', color: 'var(--error)', marginBottom: 'var(--space-5)', maxWidth: 420 }}>{authError}</p>
          )}

          <a href={loginUrl} style={{
            display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2-5)',
            height: 46, padding: '0 26px', borderRadius: 'var(--radius-lg)',
            background: '#5865F2', color: '#fff',
            fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)',
            textDecoration: 'none', fontFamily: 'var(--font-body)',
            boxShadow: '0 0 32px rgba(88,101,242,0.25), var(--shadow-md)',
            transition: 'transform 120ms var(--ease-default), box-shadow 160ms',
            animation: 'reveal 0.6s var(--ease-default) 0.3s both',
          }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.02)'; e.currentTarget.style.boxShadow = '0 0 48px rgba(88,101,242,0.35), var(--shadow-lg)' }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 0 32px rgba(88,101,242,0.25), var(--shadow-md)' }}
          >
            <LogIn size={15} />
            Continue with Discord
          </a>

          <p style={{
            fontSize: 'var(--text-xs)', color: 'var(--fg-4)', marginTop: 'var(--space-4)',
            animation: 'reveal 0.6s var(--ease-default) 0.4s both',
          }}>
            Requires Manage Server permission
          </p>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: 'var(--space-10) var(--space-6)' }}>
        {/* Header */}
        <div style={{ marginBottom: 'var(--space-10)', animation: 'fade-up 0.4s var(--ease-default) both' }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-md)', color: 'var(--fg-3)', marginBottom: 'var(--space-2)' }}>
            {getGreeting(user.username)}
          </p>
        </div>

        {/* Stats */}
        {stats && (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-3)',
            marginBottom: 'var(--space-10)',
            animation: 'fade-up 0.5s var(--ease-default) 0.06s both',
          }}>
            <StatCard icon={Server} label="Servers" value={stats.guilds} accent="var(--accent)" />
            <StatCard icon={Users} label="Users" value={stats.users?.toLocaleString()} accent="var(--success)" />
            <StatCard icon={Terminal} label="Commands" value={stats.commands} accent="var(--warning)" />
            <StatCard icon={Activity} label="Uptime" value={`${Math.floor(stats.uptime / 3600)}h`} accent="var(--info)" />
          </div>
        )}

        {/* Guilds */}
        <div style={{ animation: 'fade-up 0.5s var(--ease-default) 0.12s both' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-md)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-2)', letterSpacing: 'var(--tracking-snug)' }}>Your Servers</h2>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>{guilds.length}</span>
          </div>

          {guilds.length === 0 ? (
            <div style={{ padding: 'var(--space-12)', textAlign: 'center', borderRadius: 'var(--radius-xl)', border: '1px dashed var(--border-default)', background: 'var(--surface-1)' }}>
              <Server size={28} style={{ color: 'var(--fg-4)', margin: '0 auto var(--space-4)' }} />
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-3)' }}>no servers found. make sure sonder's in your server.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 'var(--space-3)' }}>
              {guilds.map((g, i) => (
                <div key={g.id} style={{ animation: `fade-up 0.4s var(--ease-default) ${0.04 * i}s both` }}>
                  <GuildCard guild={g} index={i} onClick={() => navigate(`/dashboard/${g.id}`)} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
