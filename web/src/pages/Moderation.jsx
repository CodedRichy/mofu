import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Shield, AlertTriangle, StickyNote, BarChart3, Trash2, Search, Server, Users } from 'lucide-react'
import { NOISE_SVG } from '../components/Layout'
import { Tabs } from '../components/Tabs'
import { Badge } from '../components/Badge'
import { Avatar } from '../components/Avatar'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { api } from '../lib/api'
import { useToken } from '../lib/auth'

function NavItem({ icon: Icon, label, active, onClick }) {
  const [h, setH] = useState(false)
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2-5)',
        width: '100%', height: 34, padding: '0 var(--space-3)',
        borderRadius: 'var(--radius-md)', cursor: 'pointer', marginBottom: 2,
        background: active ? 'var(--accent-subtle)' : h ? 'var(--surface-hover)' : 'transparent',
        border: active ? '1px solid var(--border-accent)' : '1px solid transparent',
        transition: 'all 120ms var(--ease-default)',
        position: 'relative',
      }}
    >
      {active && (
        <div style={{
          position: 'absolute', left: -1, top: '50%', transform: 'translateY(-50%)',
          width: 2, height: 16, borderRadius: 2, background: 'var(--accent)',
        }} />
      )}
      <Icon size={14} style={{ color: active ? 'var(--accent)' : h ? 'var(--fg-2)' : 'var(--fg-3)', transition: 'color 100ms', flexShrink: 0 }} />
      <span style={{
        fontSize: 'var(--text-sm)', fontFamily: 'var(--font-body)',
        color: active ? 'var(--fg-1)' : h ? 'var(--fg-2)' : 'var(--fg-3)',
        fontWeight: active ? 'var(--weight-medium)' : 'var(--weight-normal)',
        transition: 'color 100ms',
      }}>{label}</span>
    </button>
  )
}

function SectionCard({ title, children, style }) {
  return (
    <div style={{
      padding: 'var(--space-5)', borderRadius: 'var(--radius-xl)',
      border: '1px solid var(--border-default)',
      background: 'var(--surface-1)',
      boxShadow: 'var(--shadow-xs)',
      ...style,
    }}>
      {title && (
        <div style={{
          fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-2)',
          textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
          marginBottom: 'var(--space-4)', paddingBottom: 'var(--space-3)',
          borderBottom: '1px solid var(--border-subtle)',
        }}>{title}</div>
      )}
      {children}
    </div>
  )
}

function SearchField({ value, onChange, placeholder }) {
  const [focused, setFocused] = useState(false)
  return (
    <div style={{
      display: 'flex', alignItems: 'center', borderRadius: 'var(--radius-md)',
      border: `1px solid ${focused ? 'var(--border-focus)' : 'var(--border-default)'}`,
      background: 'var(--surface-1)',
      boxShadow: focused ? '0 0 0 3px rgba(255, 255, 255, 0.05)' : 'none',
      transition: 'border-color 100ms var(--ease-default), box-shadow 100ms var(--ease-default)',
      overflow: 'hidden',
    }}>
      <span style={{ display: 'flex', padding: '0 0 0 var(--space-3)', color: 'var(--fg-4)' }}>
        <Search size={13} />
      </span>
      <input
        type="text"
        aria-label={placeholder || 'Filter'}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        style={{
          width: '100%', height: 'var(--input-height-md)', padding: '0 var(--space-3)',
          background: 'transparent', border: 'none',
          color: 'var(--fg-1)', fontSize: 'var(--text-sm)',
          outline: 'none', fontFamily: 'var(--font-body)',
        }}
      />
    </div>
  )
}

function DeleteButton({ onConfirm }) {
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!confirming) return
    const timer = setTimeout(() => setConfirming(false), 3000)
    return () => clearTimeout(timer)
  }, [confirming])

  function handleClick() {
    if (confirming) {
      onConfirm()
      setConfirming(false)
    } else {
      setConfirming(true)
    }
  }

  return (
    <Button
      variant={confirming ? 'destructive' : 'ghost'}
      size="sm"
      onClick={handleClick}
      leftIcon={<Trash2 size={12} />}
      style={confirming ? {
        background: 'var(--error-subtle)',
        border: '1px solid var(--error-border)',
        color: 'var(--error)',
        fontWeight: 'var(--weight-semibold)',
      } : undefined}
    >
      {confirming ? 'Confirm' : 'Delete'}
    </Button>
  )
}

function EmptyState({ icon: Icon, message }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 'var(--space-12) var(--space-6)', color: 'var(--fg-4)',
    }}>
      <Icon size={32} style={{ marginBottom: 'var(--space-3)', opacity: 0.5 }} />
      <span style={{ fontSize: 'var(--text-sm)', fontFamily: 'var(--font-body)' }}>{message}</span>
    </div>
  )
}

function formatDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function TableRow({ children, style }) {
  const [h, setH] = useState(false)
  return (
    <div
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)',
        background: h ? 'var(--surface-hover)' : 'transparent',
        transition: 'background 120ms var(--ease-default)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

function WarningsTab({ warnings, search, onDelete }) {
  const filtered = warnings.filter(w =>
    w.username.toLowerCase().includes(search.toLowerCase()) ||
    w.userId.includes(search) ||
    (w.reason || '').toLowerCase().includes(search.toLowerCase())
  )

  if (filtered.length === 0) {
    return <EmptyState icon={AlertTriangle} message={search ? 'No warnings match your search' : 'clean slate. no warnings yet.'} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
        padding: 'var(--space-2) var(--space-4)',
        fontSize: 10, fontWeight: 'var(--weight-semibold)', color: 'var(--fg-4)',
        textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
      }}>
        <span style={{ width: 180 }}>User</span>
        <span style={{ flex: 1 }}>Reason</span>
        <span style={{ width: 130 }}>Moderator</span>
        <span style={{ width: 100 }}>Date</span>
        <span style={{ width: 80, textAlign: 'right' }}>Actions</span>
      </div>
      <div style={{ height: 1, background: 'var(--border-subtle)', margin: '0 var(--space-2)' }} />
      {filtered.map(w => (
        <TableRow key={w.id}>
          <div style={{ width: 180, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
            <Avatar src={w.avatar} initials={w.username.slice(0, 2).toUpperCase()} size="xs" />
            <span style={{
              fontSize: 'var(--text-sm)', color: 'var(--fg-1)', fontWeight: 'var(--weight-medium)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{w.username}</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{
              fontSize: 'var(--text-sm)', color: 'var(--fg-2)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block',
            }}>{w.reason || 'No reason provided'}</span>
          </div>
          <div style={{ width: 130, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
            <Avatar src={w.moderatorAvatar} initials={w.moderatorName.slice(0, 2).toUpperCase()} size="xs" />
            <span style={{
              fontSize: 'var(--text-xs)', color: 'var(--fg-3)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{w.moderatorName}</span>
          </div>
          <span style={{ width: 100, fontSize: 'var(--text-xs)', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>
            {formatDate(w.timestamp)}
          </span>
          <div style={{ width: 80, display: 'flex', justifyContent: 'flex-end' }}>
            <DeleteButton onConfirm={() => onDelete(w.id)} />
          </div>
        </TableRow>
      ))}
    </div>
  )
}

function NotesTab({ notes, search, onDelete }) {
  const filtered = notes.filter(n =>
    n.username.toLowerCase().includes(search.toLowerCase()) ||
    n.userId.includes(search) ||
    (n.content || '').toLowerCase().includes(search.toLowerCase())
  )

  if (filtered.length === 0) {
    return <EmptyState icon={StickyNote} message={search ? 'No notes match your search' : "nothing noted. that's a good sign."} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
        padding: 'var(--space-2) var(--space-4)',
        fontSize: 10, fontWeight: 'var(--weight-semibold)', color: 'var(--fg-4)',
        textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
      }}>
        <span style={{ width: 180 }}>User</span>
        <span style={{ flex: 1 }}>Content</span>
        <span style={{ width: 130 }}>Moderator</span>
        <span style={{ width: 100 }}>Date</span>
        <span style={{ width: 80, textAlign: 'right' }}>Actions</span>
      </div>
      <div style={{ height: 1, background: 'var(--border-subtle)', margin: '0 var(--space-2)' }} />
      {filtered.map(n => (
        <TableRow key={n.id}>
          <div style={{ width: 180, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
            <Avatar src={n.avatar} initials={n.username.slice(0, 2).toUpperCase()} size="xs" />
            <span style={{
              fontSize: 'var(--text-sm)', color: 'var(--fg-1)', fontWeight: 'var(--weight-medium)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{n.username}</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{
              fontSize: 'var(--text-sm)', color: 'var(--fg-2)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block',
            }}>{n.content}</span>
          </div>
          <div style={{ width: 130, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
            <Avatar src={n.moderatorAvatar} initials={n.moderatorName.slice(0, 2).toUpperCase()} size="xs" />
            <span style={{
              fontSize: 'var(--text-xs)', color: 'var(--fg-3)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{n.moderatorName}</span>
          </div>
          <span style={{ width: 100, fontSize: 'var(--text-xs)', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>
            {formatDate(n.timestamp)}
          </span>
          <div style={{ width: 80, display: 'flex', justifyContent: 'flex-end' }}>
            <DeleteButton onConfirm={() => onDelete(n.id)} />
          </div>
        </TableRow>
      ))}
    </div>
  )
}

function ModStatsTab({ stats }) {
  if (stats.length === 0) {
    return <EmptyState icon={BarChart3} message="all quiet on the mod front. no activity yet." />
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 'var(--space-4)' }}>
      {stats.map(s => (
        <Card key={s.moderator} variant="default" padding="md">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
            <Avatar src={s.moderatorAvatar} initials={s.moderatorName.slice(0, 2).toUpperCase()} size="sm" />
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-1)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{s.moderatorName}</div>
              <div style={{ fontSize: 10, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>
                {s.total} total actions
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <div style={{
              flex: 1, padding: 'var(--space-2-5)', borderRadius: 'var(--radius-md)',
              background: 'var(--warning-subtle)', textAlign: 'center',
            }}>
              <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', color: 'var(--warning)' }}>{s.warnings}</div>
              <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 2 }}>Warnings</div>
            </div>
            <div style={{
              flex: 1, padding: 'var(--space-2-5)', borderRadius: 'var(--radius-md)',
              background: 'var(--accent-subtle)', textAlign: 'center',
            }}>
              <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', color: 'var(--accent)' }}>{s.notes}</div>
              <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 2 }}>Notes</div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}

export function Moderation() {
  const { guildId } = useParams()
  const navigate = useNavigate()
  const token = useToken()
  const [errors, setErrors] = useState({})
  const [actionError, setActionError] = useState(null)
  const [tab, setTab] = useState('warnings')
  const [search, setSearch] = useState('')
  const [warnings, setWarnings] = useState(null)
  const [notes, setNotes] = useState(null)
  const [modStats, setModStats] = useState(null)
  const [guild, setGuild] = useState(null)

  useEffect(() => {
    if (!token) { navigate('/dashboard'); return }
    // Fetch guild info for sidebar
    api(`/guilds/${guildId}/config`, token).then(res => {
      if (!res.ok) navigate('/dashboard')
      else setGuild(res.data)
    })
  }, [guildId])

  // A failed fetch records an error and leaves the list null: an empty list means "really none", never "request failed".
  function load(key, path, setter) {
    setErrors(e => ({ ...e, [key]: null }))
    api(`/guilds/${guildId}${path}`, token).then(res => {
      if (res.ok) setter(res.data || [])
      else setErrors(e => ({ ...e, [key]: res.error }))
    })
  }

  useEffect(() => {
    if (!token) return
    if (tab === 'warnings' && !warnings && !errors.warnings) load('warnings', '/warnings', setWarnings)
    if (tab === 'notes' && !notes && !errors.notes) load('notes', '/notes', setNotes)
    if (tab === 'stats' && !modStats && !errors.stats) load('stats', '/modstats', setModStats)
  }, [tab, guildId])

  async function deleteWarning(id) {
    setActionError(null)
    const res = await api(`/guilds/${guildId}/warnings/${id}`, token, { method: 'DELETE' })
    if (res.ok && res.data?.success) setWarnings(prev => prev.filter(w => w.id !== id))
    else setActionError(res.error || "Couldn't delete that warning.")
  }

  async function deleteNote(id) {
    setActionError(null)
    const res = await api(`/guilds/${guildId}/notes/${id}`, token, { method: 'DELETE' })
    if (res.ok && res.data?.success) setNotes(prev => prev.filter(n => n.id !== id))
    else setActionError(res.error || "Couldn't delete that note.")
  }

  if (!guild) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid var(--border-default)', borderTopColor: 'var(--accent)', animation: 'spin 0.7s linear infinite' }} />
      </div>
    )
  }

  const navItems = [
    { id: 'warnings', label: 'Warnings', icon: AlertTriangle },
    { id: 'notes', label: 'Notes', icon: StickyNote },
    { id: 'stats', label: 'Mod Stats', icon: BarChart3 },
  ]

  const tabItems = [
    { id: 'warnings', label: 'Warnings' },
    { id: 'notes', label: 'Notes' },
    { id: 'stats', label: 'Mod Stats' },
  ]

  const failed = (key, label) => (
    <div role="alert" style={{ padding: 'var(--space-8) var(--space-4)', textAlign: 'center', color: 'var(--error)', fontSize: 'var(--text-sm)' }}>
      <div>{"Couldn't load " + label + "."}</div>
      <div style={{ color: 'var(--fg-3)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-1)' }}>{errors[key]}</div>
      <div style={{ marginTop: 'var(--space-3)' }}>
        <Button variant="secondary" size="sm" onClick={() => load(key, { warnings: '/warnings', notes: '/notes', stats: '/modstats' }[key], { warnings: setWarnings, notes: setNotes, stats: setModStats }[key])}>Retry</Button>
      </div>
    </div>
  )

  const loading = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-12)' }}>
      <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid var(--border-default)', borderTopColor: 'var(--accent)', animation: 'spin 0.7s linear infinite' }} />
    </div>
  )

  return (
    <div className="dash-shell">
      {/* Noise overlay */}
      <div style={{ position: 'fixed', inset: 0, backgroundImage: NOISE_SVG, backgroundRepeat: 'repeat', pointerEvents: 'none', zIndex: 0, opacity: 0.5 }} />

      {/* Sidebar */}
      <aside className="dash-aside" style={{
        width: 'var(--sidebar-width)', flexShrink: 0,
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex', flexDirection: 'column',
        padding: 'var(--space-4) var(--space-3)',
        background: 'var(--bg-subtle)',
        position: 'relative', zIndex: 1,
      }}>
        {/* Back */}
        <button
          onClick={() => navigate(`/dashboard/${guildId}`)}
          style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-1-5)',
            color: 'var(--fg-3)', fontSize: 'var(--text-xs)',
            cursor: 'pointer', padding: 'var(--space-1-5) var(--space-2)',
            borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-4)',
            transition: 'color 120ms',
          }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--fg-1)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--fg-3)'}
        >
          <ArrowLeft size={12} />
          <span>Server settings</span>
        </button>

        {/* Server identity */}
        <div className="dash-hide-narrow" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2-5)', padding: '0 var(--space-2)', marginBottom: 'var(--space-6)' }}>
          {guild.icon ? (
            <img src={guild.icon} alt="" style={{ width: 30, height: 30, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }} />
          ) : (
            <div style={{
              width: 30, height: 30, borderRadius: 'var(--radius-md)',
              background: 'var(--accent-subtle)', border: '1px solid var(--border-accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Server size={14} style={{ color: 'var(--accent)' }} />
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-1)',
              lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              maxWidth: 140,
            }}>{guild.name}</div>
            <div style={{ fontSize: 10, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>{guild.memberCount?.toLocaleString()} members</div>
          </div>
        </div>

        {/* Section label */}
        <div className="dash-hide-narrow" style={{
          fontSize: 10, fontWeight: 'var(--weight-semibold)', color: 'var(--fg-4)',
          padding: '0 var(--space-3)', marginBottom: 'var(--space-2)',
          textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
        }}>Moderation</div>

        {/* Nav items */}
        <nav className="dash-nav" aria-label="Moderation">
          {navItems.map(n => (
            <NavItem key={n.id} icon={n.icon} label={n.label} active={tab === n.id} onClick={() => setTab(n.id)} />
          ))}
        </nav>

        {/* Summary counts */}
        <div className="dash-hide-narrow" style={{ marginTop: 'auto', padding: 'var(--space-3)' }}>
          <div style={{
            padding: 'var(--space-3)', borderRadius: 'var(--radius-md)',
            background: 'var(--surface-1)', border: '1px solid var(--border-subtle)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
              <Shield size={12} style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-2)', fontWeight: 'var(--weight-medium)' }}>Overview</span>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <div>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', color: 'var(--fg-1)' }}>{warnings?.length ?? '...'}</div>
                <div style={{ fontSize: 10, color: 'var(--fg-4)' }}>Warnings</div>
              </div>
              <div>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', color: 'var(--fg-1)' }}>{notes?.length ?? '...'}</div>
                <div style={{ fontSize: 10, color: 'var(--fg-4)' }}>Notes</div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="dash-main" style={{ flex: 1, overflow: 'auto', position: 'relative', zIndex: 1 }}>
        <div style={{ maxWidth: 860, animation: 'fade-up 0.3s var(--ease-default) both' }}>
          {/* Header */}
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{
              fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-bold)',
              color: 'var(--fg-1)', letterSpacing: 'var(--tracking-tight)',
            }}>Moderation</h2>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-3)', marginTop: 'var(--space-1)' }}>
              View and manage warnings, notes, and moderator activity.
            </p>
          </div>

          {/* Tabs + Search bar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
            marginBottom: 'var(--space-5)', gap: 'var(--space-4)',
          }}>
            <Tabs
              items={tabItems}
              activeId={tab}
              onChange={setTab}
              variant="pills"
            />
            {tab !== 'stats' && (
              <div style={{ width: 260, maxWidth: '100%' }}>
                <SearchField value={search} onChange={setSearch} placeholder="Filter by user..." />
              </div>
            )}
          </div>

          {actionError && (
            <div role="alert" style={{ marginBottom: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--error)', background: 'var(--error-subtle)', border: '1px solid var(--error-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)' }}>{actionError}</div>
          )}

          {/* Content */}
          <SectionCard>
            {tab === 'warnings' && (
              errors.warnings && warnings === null ? failed('warnings', 'warnings') : warnings === null ? loading : (
                <>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: 'var(--space-3)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <Badge variant="warning">{warnings.length} warning{warnings.length !== 1 ? 's' : ''}</Badge>
                    </div>
                  </div>
                  <div className="table-scroll"><div className="table-inner"><WarningsTab warnings={warnings} search={search} onDelete={deleteWarning} /></div></div>
                </>
              )
            )}

            {tab === 'notes' && (
              errors.notes && notes === null ? failed('notes', 'notes') : notes === null ? loading : (
                <>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: 'var(--space-3)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <Badge variant="accent">{notes.length} note{notes.length !== 1 ? 's' : ''}</Badge>
                    </div>
                  </div>
                  <div className="table-scroll"><div className="table-inner"><NotesTab notes={notes} search={search} onDelete={deleteNote} /></div></div>
                </>
              )
            )}

            {tab === 'stats' && (
              errors.stats && modStats === null ? failed('stats', 'moderator stats') : modStats === null ? loading : (
                <ModStatsTab stats={modStats} />
              )
            )}
          </SectionCard>
        </div>
      </main>
    </div>
  )
}
