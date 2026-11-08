import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, History } from 'lucide-react'
import { api } from '../lib/api'
import { Card } from './Card'
import { Avatar } from './Avatar'

const ACTION_LABELS = {
  'config.update': 'Updated settings',
  'automod.update': 'Updated automod',
  'leveling.update': 'Updated leveling',
  'custom_command.create': 'Added a custom command',
  'custom_command.delete': 'Removed a custom command',
  'economy.set': 'Set a member\'s balance',
  'xp.set': 'Set a member\'s xp',
  'warning.delete': 'Deleted a warning',
  'note.delete': 'Deleted a note',
}

export function actionLabel(action) {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action]
  const s = String(action || '').replace(/[._]+/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Changed something'
}

const RELATIVE_STEPS = [
  ['year', 31536000000], ['month', 2592000000], ['week', 604800000],
  ['day', 86400000], ['hour', 3600000], ['minute', 60000],
]

export function relativeTime(ts, now = Date.now()) {
  const diff = ts - now
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  for (const [unit, ms] of RELATIVE_STEPS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit)
  }
  return 'just now'
}

const GRID = 'minmax(120px, 1.1fr) minmax(90px, 1fr) minmax(130px, 1.1fr) minmax(0, 2fr)'

const headStyle = {
  display: 'grid', gridTemplateColumns: GRID, gap: 'var(--space-3)',
  padding: 'var(--space-2) var(--space-3)',
  fontSize: 10, fontWeight: 'var(--weight-semibold)', color: 'var(--fg-4)',
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
  borderBottom: '1px solid var(--border-subtle)',
}

function PageSizeButton({ size, active, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        height: 26, padding: '0 var(--space-2-5)', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
        fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)',
        background: active ? 'var(--accent-subtle)' : 'transparent',
        border: active ? '1px solid var(--border-accent)' : '1px solid var(--border-default)',
        color: active ? 'var(--accent)' : 'var(--fg-3)',
      }}
    >{size}</button>
  )
}

function PagerButton({ label, disabled, onClick, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 28, height: 28, borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-default)', background: 'transparent',
        color: disabled ? 'var(--fg-4)' : 'var(--fg-2)',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      }}
    >{children}</button>
  )
}

export function AuditLog({ guildId, token }) {
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(0)
  const [data, setData] = useState(null) // { records, total }
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    setLoading(true)
    api(`/guilds/${guildId}/audit?limit=${pageSize}&offset=${page * pageSize}`, token).then(res => {
      if (!live) return
      if (res.ok) { setData(res.data); setError(null) }
      else setError(res.error)
      setLoading(false)
    })
    return () => { live = false }
  }, [guildId, token, pageSize, page])

  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const records = data?.records ?? []

  function changeSize(size) {
    // keep the first row of the current page in view
    setPage(Math.floor((page * pageSize) / size))
    setPageSize(size)
  }

  return (
    <Card padding="md">
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-3)', lineHeight: 1.6, marginBottom: 'var(--space-4)' }}>
        changes made on this dashboard. things done with bot commands aren't listed here, and values are never stored, only which setting changed.
      </p>

      {error && !data ? (
        <div role="alert" style={{
          fontSize: 'var(--text-xs)', color: 'var(--error)', background: 'var(--error-subtle)',
          border: '1px solid var(--error-border)', borderRadius: 'var(--radius-md)',
          padding: 'var(--space-2) var(--space-3)',
        }}>{"couldn't load activity. " + error}</div>
      ) : !data ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-8)' }}>
          <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid var(--border-default)', borderTopColor: 'var(--accent)', animation: 'spin 0.7s linear infinite' }} />
        </div>
      ) : total === 0 ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-8) var(--space-4)', color: 'var(--fg-4)', fontSize: 'var(--text-sm)' }}>
          <History size={24} style={{ margin: '0 auto var(--space-2)', display: 'block', opacity: 0.4 }} />
          no changes yet.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', opacity: loading ? 0.6 : 1, transition: 'opacity 120ms var(--ease-default)' }}>
          <div style={{ minWidth: 560 }}>
            <div style={headStyle}>
              <span>When</span><span>Who</span><span>Action</span><span>Detail</span>
            </div>
            {records.map(r => {
              const d = new Date(r.created_at)
              return (
                <div key={r.id} style={{
                  display: 'grid', gridTemplateColumns: GRID, gap: 'var(--space-3)',
                  padding: 'var(--space-2-5) var(--space-3)', alignItems: 'center',
                  borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--text-sm)',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-2)' }}>{relativeTime(r.created_at)}</div>
                    <div style={{ fontSize: 10, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>{d.toLocaleString()}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
                    <Avatar size="xs" initials={String(r.username || r.user_id || '?').charAt(0).toUpperCase()} />
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.username || r.user_id}
                    </span>
                  </div>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-1)', fontWeight: 'var(--weight-medium)' }}>{actionLabel(r.action)}</span>
                  <span title={r.detail || ''} style={{
                    fontSize: 'var(--text-xs)', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{r.detail || ''}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {data && total > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
          gap: 'var(--space-3)', marginTop: 'var(--space-4)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1-5)', fontSize: 'var(--text-xs)', color: 'var(--fg-3)' }}>
            <span>per page</span>
            {[10, 25].map(s => <PageSizeButton key={s} size={s} active={pageSize === s} onClick={() => changeSize(s)} />)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              {page + 1} / {pages} ({total})
            </span>
            <PagerButton label="Previous page" disabled={page === 0 || loading} onClick={() => setPage(p => Math.max(0, p - 1))}><ChevronLeft size={14} /></PagerButton>
            <PagerButton label="Next page" disabled={page >= pages - 1 || loading} onClick={() => setPage(p => p + 1)}><ChevronRight size={14} /></PagerButton>
          </div>
        </div>
      )}
    </Card>
  )
}
