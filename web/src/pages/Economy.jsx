import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Trophy, Search, User, ShoppingBag, Wallet, Landmark, Plus, Minus, Save, Check, RefreshCw, Hash } from 'lucide-react'
import { NOISE_SVG } from '../components/Layout'
import { api } from '../lib/api'
import { useToken } from '../lib/auth'

function LoadError({ what, message }) {
  return (
    <div role="alert" style={{
      padding: 'var(--space-8) var(--space-4)', textAlign: 'center', borderRadius: 'var(--radius-lg)',
      background: 'var(--error-subtle)', border: '1px solid var(--error-border)',
      color: 'var(--error)', fontSize: 'var(--text-sm)',
    }}>
      <div>{"Couldn't load " + what + "."}</div>
      {message && <div style={{ color: 'var(--fg-3)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-1)' }}>{message}</div>}
    </div>
  )
}

function fmt(n) {
  return (n || 0).toLocaleString()
}

function TabButton({ icon: Icon, label, active, onClick }) {
  const [h, setH] = useState(false)
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        height: 34, padding: '0 14px', borderRadius: 'var(--radius-md)',
        background: active ? 'var(--accent-subtle)' : h ? 'var(--surface-hover)' : 'transparent',
        border: active ? '1px solid var(--border-accent)' : '1px solid transparent',
        color: active ? 'var(--accent)' : h ? 'var(--fg-2)' : 'var(--fg-3)',
        fontWeight: active ? 500 : 400,
        fontSize: 13, fontFamily: 'var(--font-body)',
        cursor: 'pointer', transition: 'all 100ms var(--ease-default)',
        letterSpacing: '-0.01em',
      }}
    >
      <Icon size={14} />
      {label}
    </button>
  )
}

function LeaderboardTab({ guildId, token, onView }) {
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setLoadError(null)
    api(`/guilds/${guildId}/economy`, token).then(res => {
      if (res.ok) setData(res.data || [])
      else setLoadError(res.error)
      setLoading(false)
    })
  }, [guildId])

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-10)' }}>
        <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid var(--border-default)', borderTopColor: 'var(--accent)', animation: 'spin 0.7s linear infinite' }} />
      </div>
    )
  }

  if (loadError || !data) return <LoadError what="the leaderboard" message={loadError} />

  const filtered = data.filter(r => r.user_id.includes(filter))

  return (
    <div style={{ animation: 'fade-up 0.3s var(--ease-default) both' }}>
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-bold)', color: 'var(--fg-1)', letterSpacing: 'var(--tracking-tight)' }}>
          Leaderboard
        </h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-3)', marginTop: 'var(--space-1)' }}>
          Top 50 users ranked by total balance.
        </p>
      </div>

      {/* Search */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        height: 36, padding: '0 var(--space-3)',
        background: 'var(--surface-1)', border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-4)',
      }}>
        <Search size={13} style={{ color: 'var(--fg-4)', flexShrink: 0 }} />
        <input
          aria-label="Filter by user ID"
          placeholder="Filter by user ID..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{
            flex: 1, background: 'none', border: 'none', outline: 'none',
            color: 'var(--fg-1)', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-body)',
          }}
        />
      </div>

      {filtered.length === 0 ? (
        <div style={{
          padding: 'var(--space-10)', textAlign: 'center',
          color: 'var(--fg-3)', fontSize: 'var(--text-sm)',
          background: 'var(--surface-1)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-default)',
        }}>
          {data.length === 0 ? "economy's quiet. someone should `;daily`." : 'No results matching your filter.'}
        </div>
      ) : (
        <div className="table-scroll" style={{
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-default)',
        }}><div className="table-inner">
          {/* Table header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '56px 1fr 120px 120px 130px 80px',
            padding: '10px var(--space-4)', background: 'var(--surface-2)',
            borderBottom: '1px solid var(--border-default)',
          }}>
            {['Rank', 'User ID', 'Wallet', 'Bank', 'Total', 'Actions'].map(h => (
              <span key={h} style={{
                fontSize: 10, fontWeight: 'var(--weight-semibold)', color: 'var(--fg-4)',
                textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
              }}>{h}</span>
            ))}
          </div>

          {/* Rows */}
          {filtered.map((row, i) => (
            <LeaderboardRow key={row.user_id} row={row} rank={i + 1} even={i % 2 === 0} onView={onView} />
          ))}
        </div></div>
      )}
    </div>
  )
}

function LeaderboardRow({ row, rank, even, onView }) {
  const [h, setH] = useState(false)

  const rankStyle = rank <= 3 ? {
    1: { color: 'var(--warning)', fontWeight: 700 },
    2: { color: 'var(--fg-1)', fontWeight: 600 },
    3: { color: 'var(--fg-2)', fontWeight: 600 },
  }[rank] : { color: 'var(--fg-3)' }

  return (
    <div
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: 'grid', gridTemplateColumns: '56px 1fr 120px 120px 130px 80px',
        padding: '10px var(--space-4)', alignItems: 'center',
        background: h ? 'var(--surface-hover)' : even ? 'var(--surface-1)' : 'var(--bg)',
        borderBottom: '1px solid var(--border-subtle)',
        transition: 'background 80ms',
      }}
    >
      <span style={{ fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)', ...rankStyle }}>
        {rank <= 3 ? ['', '#1', '#2', '#3'][rank] : `#${rank}`}
      </span>
      <span style={{
        fontSize: 'var(--text-sm)', color: 'var(--fg-2)', fontFamily: 'var(--font-mono)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {row.user_id}
      </span>
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-2)' }}>
        <span style={{ color: 'var(--fg-4)', marginRight: 2 }}>{'⌴'}</span> {fmt(row.wallet)}
      </span>
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-2)' }}>
        <span style={{ color: 'var(--fg-4)', marginRight: 2 }}>{'⌴'}</span> {fmt(row.bank)}
      </span>
      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-1)' }}>
        <span style={{ color: 'var(--accent)', marginRight: 2 }}>{'⌴'}</span> {fmt(row.total)}
      </span>
      <button
        type="button"
        onClick={() => onView(row.user_id)}
        aria-label={`View ${row.user_id}`}
        style={{
          fontSize: 'var(--text-xs)', color: 'var(--accent)', textAlign: 'left',
          cursor: 'pointer', padding: 0,
          opacity: h ? 1 : 0.7, transition: 'opacity 100ms',
        }}
      >
        View
      </button>
    </div>
  )
}

function UserLookupTab({ guildId, token, seedUserId }) {
  const [userId, setUserId] = useState(seedUserId || '')
  const [userData, setUserData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [editWallet, setEditWallet] = useState('')
  const [editBank, setEditBank] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  // Coming from the leaderboard's View link: look the user up straight away.
  useEffect(() => {
    if (seedUserId) lookup(seedUserId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedUserId])

  async function lookup(idOverride) {
    const id = (typeof idOverride === 'string' ? idOverride : userId).trim()
    if (!id) return
    setLoading(true)
    setError(null)
    setUserData(null)
    try {
      const res = await api(`/guilds/${guildId}/economy/${encodeURIComponent(id)}`, token)
      if (res.ok && res.data) {
        setUserData(res.data)
        setEditWallet(String(res.data.wallet))
        setEditBank(String(res.data.bank))
      } else if (res.status === 404) {
        setError('User not found or no economy data.')
      } else {
        setError(res.error || 'Lookup failed.')
      }
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    setSaving(true)
    setSaved(false)
    try {
      const w = parseInt(editWallet, 10)
      const b = parseInt(editBank, 10)
      if (isNaN(w) || isNaN(b)) {
        setError('Values must be valid numbers.')
        return
      }
      setError(null)
      const res = await api(`/guilds/${guildId}/economy/${encodeURIComponent(userId.trim())}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ wallet: w, bank: b }),
      })
      if (res.ok && res.data) {
        setUserData(res.data)
        setEditWallet(String(res.data.wallet))
        setEditBank(String(res.data.bank))
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      } else {
        setError(res.error || 'Failed to save changes.')
      }
    } finally {
      setSaving(false)
    }
  }

  function adjust(field, amount) {
    if (field === 'wallet') {
      setEditWallet(String(Math.max(0, (parseInt(editWallet, 10) || 0) + amount)))
    } else {
      setEditBank(String(Math.max(0, (parseInt(editBank, 10) || 0) + amount)))
    }
    setSaved(false)
  }

  return (
    <div style={{ animation: 'fade-up 0.3s var(--ease-default) both' }}>
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-bold)', color: 'var(--fg-1)', letterSpacing: 'var(--tracking-tight)' }}>
          User Lookup
        </h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-3)', marginTop: 'var(--space-1)' }}>
          Search by Discord user ID and manage their balance.
        </p>
      </div>

      {/* Search bar */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-6)' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flex: 1,
          height: 36, padding: '0 var(--space-3)',
          background: 'var(--surface-1)', border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
        }}>
          <Hash size={13} style={{ color: 'var(--fg-4)', flexShrink: 0 }} />
          <input
            aria-label="Discord user ID"
            placeholder="Enter user ID (e.g. 123456789012345678)"
            value={userId}
            onChange={e => setUserId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && lookup()}
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              color: 'var(--fg-1)', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-body)',
            }}
          />
        </div>
        <button
          onClick={() => lookup()}
          disabled={loading || !userId.trim()}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-1-5)',
            height: 36, padding: '0 16px', borderRadius: 'var(--radius-md)',
            background: 'var(--accent)', color: 'var(--accent-fg)',
            fontSize: 'var(--text-sm)', fontWeight: 500, fontFamily: 'var(--font-body)',
            cursor: loading ? 'wait' : 'pointer',
            border: '1px solid rgba(0,0,0,0.18)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)',
            opacity: !userId.trim() ? 0.5 : 1,
            transition: 'opacity 100ms',
          }}
        >
          {loading ? <RefreshCw size={13} style={{ animation: 'spin 0.7s linear infinite' }} /> : <Search size={13} />}
          Lookup
        </button>
      </div>

      {error && (
        <div role="alert" style={{
          padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)',
          background: 'var(--error-subtle)', border: '1px solid var(--error-border)',
          color: 'var(--error)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)',
        }}>
          {error}
        </div>
      )}

      {userData && (
        <div style={{
          padding: 'var(--space-5)', borderRadius: 'var(--radius-xl)',
          border: '1px solid var(--border-default)', background: 'var(--surface-1)',
          boxShadow: 'var(--shadow-xs)',
        }}>
          {/* User header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
            marginBottom: 'var(--space-5)', paddingBottom: 'var(--space-4)',
            borderBottom: '1px solid var(--border-subtle)',
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: 'var(--radius-lg)',
              background: 'var(--accent-subtle)', border: '1px solid var(--border-accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <User size={18} style={{ color: 'var(--accent)' }} />
            </div>
            <div>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-1)' }}>
                User Economy Profile
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                {userId.trim()}
              </div>
            </div>
            <div style={{ marginLeft: 'auto' }}>
              <span style={{
                fontSize: 'var(--text-xs)', padding: '3px 8px', borderRadius: 'var(--radius-full)',
                background: 'var(--accent-subtle)', border: '1px solid var(--border-accent)',
                color: 'var(--accent)', fontWeight: 500,
              }}>
                Total: {'⌴'} {fmt(userData.total)}
              </span>
            </div>
          </div>

          {/* Edit fields */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 'var(--space-4)' }}>
            {/* Wallet */}
            <div>
              <label htmlFor="eco-wallet" style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-1-5)',
                fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--fg-2)',
                marginBottom: 'var(--space-2)', letterSpacing: '0.01em',
              }}>
                <Wallet size={12} />
                Wallet
              </label>
              <div style={{ display: 'flex', gap: 'var(--space-1-5)' }}>
                <AdjustButton label="-100" onClick={() => adjust('wallet', -100)} variant="minus" />
                <div style={{
                  flex: 1, display: 'flex', alignItems: 'center',
                  height: 36, padding: '0 var(--space-3)',
                  background: 'var(--bg)', border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                }}>
                  <span style={{ color: 'var(--fg-4)', marginRight: 4, fontSize: 'var(--text-sm)' }}>{'⌴'}</span>
                  <input
                    id="eco-wallet"
                    type="number"
                    value={editWallet}
                    onChange={e => { setEditWallet(e.target.value); setSaved(false) }}
                    style={{
                      flex: 1, background: 'none', border: 'none', outline: 'none',
                      color: 'var(--fg-1)', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)',
                      minWidth: 0,
                    }}
                  />
                </div>
                <AdjustButton label="+100" onClick={() => adjust('wallet', 100)} variant="plus" />
              </div>
            </div>

            {/* Bank */}
            <div>
              <label htmlFor="eco-bank" style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-1-5)',
                fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--fg-2)',
                marginBottom: 'var(--space-2)', letterSpacing: '0.01em',
              }}>
                <Landmark size={12} />
                Bank
              </label>
              <div style={{ display: 'flex', gap: 'var(--space-1-5)' }}>
                <AdjustButton label="-100" onClick={() => adjust('bank', -100)} variant="minus" />
                <div style={{
                  flex: 1, display: 'flex', alignItems: 'center',
                  height: 36, padding: '0 var(--space-3)',
                  background: 'var(--bg)', border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                }}>
                  <span style={{ color: 'var(--fg-4)', marginRight: 4, fontSize: 'var(--text-sm)' }}>{'⌴'}</span>
                  <input
                    id="eco-bank"
                    type="number"
                    value={editBank}
                    onChange={e => { setEditBank(e.target.value); setSaved(false) }}
                    style={{
                      flex: 1, background: 'none', border: 'none', outline: 'none',
                      color: 'var(--fg-1)', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)',
                      minWidth: 0,
                    }}
                  />
                </div>
                <AdjustButton label="+100" onClick={() => adjust('bank', 100)} variant="plus" />
              </div>
            </div>
          </div>

          {/* Save */}
          <div style={{ marginTop: 'var(--space-5)', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={save}
              disabled={saving}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)',
                height: 36, padding: '0 20px', borderRadius: 'var(--radius-md)',
                background: saved ? 'var(--success-subtle)' : 'var(--accent)',
                color: saved ? 'var(--success)' : 'var(--accent-fg)',
                fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)',
                fontFamily: 'var(--font-body)', cursor: saving ? 'wait' : 'pointer',
                border: saved ? '1px solid var(--success-border)' : '1px solid rgba(0,0,0,0.2)',
                boxShadow: saved ? 'none' : '0 1px 3px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)',
                transition: 'all 160ms var(--ease-default)',
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saved ? <Check size={13} /> : <Save size={13} />}
              {saving ? 'Saving...' : saved ? 'Saved' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function AdjustButton({ label, onClick, variant }) {
  const [h, setH] = useState(false)
  const isPlus = variant === 'plus'
  return (
    <button
      onClick={onClick}
      type="button"
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: 36, width: 48, borderRadius: 'var(--radius-md)',
        background: h ? (isPlus ? 'var(--success-subtle)' : 'var(--error-subtle)') : 'var(--surface-2)',
        border: `1px solid ${h ? (isPlus ? 'var(--success-border)' : 'var(--error-border)') : 'var(--border-default)'}`,
        color: h ? (isPlus ? 'var(--success)' : 'var(--error)') : 'var(--fg-3)',
        fontSize: 'var(--text-xs)', fontWeight: 500, fontFamily: 'var(--font-mono)',
        cursor: 'pointer', transition: 'all 100ms var(--ease-default)',
      }}
    >
      {label}
    </button>
  )
}

function ShopTab({ guildId, token }) {
  const [items, setItems] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  useEffect(() => {
    setLoading(true)
    setLoadError(null)
    api(`/guilds/${guildId}/shop`, token).then(res => {
      if (res.ok) setItems(res.data || [])
      else setLoadError(res.error)
      setLoading(false)
    })
  }, [guildId])

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-10)' }}>
        <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid var(--border-default)', borderTopColor: 'var(--accent)', animation: 'spin 0.7s linear infinite' }} />
      </div>
    )
  }

  if (loadError || !items) return <LoadError what="the shop" message={loadError} />

  return (
    <div style={{ animation: 'fade-up 0.3s var(--ease-default) both' }}>
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-bold)', color: 'var(--fg-1)', letterSpacing: 'var(--tracking-tight)' }}>
          Shop Items
        </h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-3)', marginTop: 'var(--space-1)' }}>
          Items available for purchase. Read-only view of the shop configuration.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {items.map(item => (
          <ShopItem key={item.id} item={item} />
        ))}
      </div>
    </div>
  )
}

function ShopItem({ item }) {
  const [h, setH] = useState(false)
  return (
    <div
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap',
        padding: 'var(--space-4) var(--space-5)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-default)',
        background: h ? 'var(--surface-2)' : 'var(--surface-1)',
        transition: 'background 120ms var(--ease-default)',
      }}
    >
      {/* Emoji */}
      <div style={{
        width: 44, height: 44, borderRadius: 'var(--radius-lg)',
        background: 'var(--surface-3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 20, flexShrink: 0,
      }}>
        {item.emoji}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-1)',
          marginBottom: 2,
        }}>
          {item.name}
        </div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-3)', lineHeight: 1.4 }}>
          {item.description}
        </div>
      </div>

      {/* Price */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '4px 10px', borderRadius: 'var(--radius-full)',
        background: 'var(--accent-subtle)', border: '1px solid var(--border-accent)',
        flexShrink: 0,
      }}>
        <span style={{ color: 'var(--accent)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
          {'⌴'}
        </span>
        <span style={{
          fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)',
          color: 'var(--fg-1)', fontFamily: 'var(--font-mono)',
        }}>
          {fmt(item.price)}
        </span>
      </div>
    </div>
  )
}

export function Economy() {
  const { guildId } = useParams()
  const navigate = useNavigate()
  const token = useToken()
  const [guild, setGuild] = useState(null)
  const [tab, setTab] = useState('leaderboard')
  const [seedUserId, setSeedUserId] = useState('')

  function viewUser(id) {
    setSeedUserId(id)
    setTab('lookup')
  }

  useEffect(() => {
    if (!token) { navigate('/dashboard'); return }
    api(`/guilds/${guildId}/config`, token).then(res => {
      if (!res.ok) navigate('/dashboard')
      else setGuild(res.data)
    })
  }, [guildId])

  if (!guild) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid var(--border-default)', borderTopColor: 'var(--accent)', animation: 'spin 0.7s linear infinite' }} />
      </div>
    )
  }

  const tabs = [
    { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
    { id: 'lookup', label: 'User Lookup', icon: User },
    { id: 'shop', label: 'Shop', icon: ShoppingBag },
  ]

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
            transition: 'color 120ms', background: 'transparent', border: 'none',
          }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--fg-1)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--fg-3)'}
        >
          <ArrowLeft size={12} />
          <span>Back to config</span>
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
              <Wallet size={14} style={{ color: 'var(--accent)' }} />
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-1)',
              lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              maxWidth: 140,
            }}>{guild.name}</div>
            <div style={{ fontSize: 10, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>Economy</div>
          </div>
        </div>

        {/* Section label */}
        <div className="dash-hide-narrow" style={{
          fontSize: 10, fontWeight: 'var(--weight-semibold)', color: 'var(--fg-4)',
          padding: '0 var(--space-3)', marginBottom: 'var(--space-2)',
          textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
        }}>Sections</div>

        {/* Tab nav */}
        <nav className="dash-nav" aria-label="Economy sections">
          {tabs.map(t => (
            <SidebarNavItem key={t.id} icon={t.icon} label={t.label} active={tab === t.id} onClick={() => setTab(t.id)} />
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="dash-main" style={{ flex: 1, overflow: 'auto', position: 'relative', zIndex: 1 }}>
        <div style={{ maxWidth: 720 }}>
          {tab === 'leaderboard' && <LeaderboardTab guildId={guildId} token={token} onView={viewUser} />}
          {tab === 'lookup' && <UserLookupTab key={seedUserId} guildId={guildId} token={token} seedUserId={seedUserId} />}
          {tab === 'shop' && <ShopTab guildId={guildId} token={token} />}
        </div>
      </main>
    </div>
  )
}

function SidebarNavItem({ icon: Icon, label, active, onClick }) {
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
