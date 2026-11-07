import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Save, Check, Trophy, Settings, Award, Hash, Users, Shield, Plus, Trash2, Server } from 'lucide-react'
import { NOISE_SVG } from '../components/Layout'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { Switch } from '../components/Switch'
import { Tabs } from '../components/Tabs'
import { Badge } from '../components/Badge'
import { api } from '../lib/api'
import { useToken } from '../lib/auth'
import { useListText } from '../lib/listText'

// Comma-separated ID list input: raw text stays local so a trailing comma or "a, b" survives typing.
function ListInput({ label, list, onList, ...rest }) {
  const [text, onText] = useListText(list, onList)
  return <Input label={label} value={text} onChange={e => onText(e.target.value)} {...rest} />
}

function xpForLevel(level) {
  return 5 * (level * level) + 50 * level + 100
}

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

function Panel({ title, description, children }) {
  return (
    <div style={{ animation: 'fade-up 0.3s var(--ease-default) both' }}>
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-bold)', color: 'var(--fg-1)', letterSpacing: 'var(--tracking-tight)' }}>{title}</h2>
        {description && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-3)', marginTop: 'var(--space-1)' }}>{description}</p>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {children}
      </div>
    </div>
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

function ProgressBar({ current, needed }) {
  const pct = needed > 0 ? Math.min((current / needed) * 100, 100) : 0
  return (
    <div style={{
      width: '100%', height: 6, borderRadius: 'var(--radius-full)',
      background: 'var(--surface-3)', overflow: 'hidden',
      position: 'relative',
    }}>
      <div style={{
        width: `${pct}%`, height: '100%', borderRadius: 'var(--radius-full)',
        background: 'linear-gradient(90deg, var(--accent), transparent)',
        transition: 'width 300ms var(--ease-default)',
      }} />
    </div>
  )
}

function Toggle({ label, description, checked, onChange }) {
  const [h, setH] = useState(false)
  return (
    <div
      role="switch"
      aria-checked={!!checked}
      aria-label={label}
      tabIndex={0}
      onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onChange(!checked) } }}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)',
        padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)',
        background: h ? 'var(--surface-hover)' : 'transparent',
        transition: 'background 120ms var(--ease-default)', cursor: 'pointer',
      }}
      onClick={() => onChange(!checked)}
    >
      <div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-1)', fontWeight: 'var(--weight-medium)' }}>{label}</div>
        {description && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-3)', marginTop: 2 }}>{description}</div>}
      </div>
      <div style={{
        width: 36, height: 20, borderRadius: 'var(--radius-full)', padding: 2,
        background: checked ? 'var(--accent)' : 'var(--surface-3)',
        border: `1px solid ${checked ? 'var(--accent)' : 'var(--border-default)'}`,
        transition: 'all 140ms var(--ease-default)',
        flexShrink: 0,
        boxShadow: checked ? '0 0 10px rgba(255, 255, 255, 0.13)' : 'none',
      }}>
        <div style={{
          width: 14, height: 14, borderRadius: '50%', background: checked ? 'var(--accent-fg)' : 'var(--fg-2)',
          transform: checked ? 'translateX(16px)' : 'translateX(0)',
          transition: 'transform 160ms var(--ease-spring)',
          boxShadow: 'var(--shadow-xs)',
        }} />
      </div>
    </div>
  )
}

export function Leveling() {
  const { guildId } = useParams()
  const navigate = useNavigate()
  const token = useToken()

  const [tab, setTab] = useState('leaderboard')
  const [leaderboard, setLeaderboard] = useState(null)
  const [config, setConfig] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [guildInfo, setGuildInfo] = useState(null)

  // Role rewards form
  const [newRoleLevel, setNewRoleLevel] = useState('')
  const [newRoleId, setNewRoleId] = useState('')

  useEffect(() => {
    if (!token) { navigate('/dashboard'); return }

    // Load guild info for sidebar
    api(`/guilds/${guildId}/config`, token).then(res => {
      if (!res.ok) navigate('/dashboard')
      else setGuildInfo(res.data)
    })

    // Load leaderboard
    api(`/guilds/${guildId}/leaderboard`, token).then(res => {
      if (res.ok) setLeaderboard(res.data || [])
      else { setLeaderboard([]); setLoadError(res.error) }
    })

    // Load leveling config. On failure keep config null-ish: defaults here would let Save overwrite real settings.
    api(`/guilds/${guildId}/leveling-config`, token).then(res => {
      if (res.ok) setConfig(res.data)
      else setLoadError(res.error)
    })
  }, [guildId])

  async function saveConfig() {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await api(`/guilds/${guildId}/leveling-config`, token, { method: 'PATCH', body: JSON.stringify(config) })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      } else {
        setSaveError(res.error)
      }
    } finally {
      setSaving(false)
    }
  }

  function updateConfig(key, value) {
    setConfig(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  function addRoleReward() {
    const level = parseInt(newRoleLevel)
    if (!level || level < 1 || !newRoleId.trim()) return
    const existing = config.level_roles || []
    if (existing.some(r => r.level === level)) return
    updateConfig('level_roles', [...existing, { level, roleId: newRoleId.trim() }].sort((a, b) => a.level - b.level))
    setNewRoleLevel('')
    setNewRoleId('')
  }

  function removeRoleReward(level) {
    updateConfig('level_roles', (config.level_roles || []).filter(r => r.level !== level))
  }

  if (loadError && !config) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-6)' }}>
        <p role="alert" style={{ color: 'var(--error)', fontSize: 'var(--text-sm)', textAlign: 'center' }}>Couldn't load leveling settings. {loadError}</p>
      </div>
    )
  }

  if (!guildInfo || leaderboard === null || !config) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid var(--border-default)', borderTopColor: 'var(--accent)', animation: 'spin 0.7s linear infinite' }} />
      </div>
    )
  }

  const navItems = [
    { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
    { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'roles', label: 'Role Rewards', icon: Award },
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
          {guildInfo.icon ? (
            <img src={guildInfo.icon} alt="" style={{ width: 30, height: 30, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }} />
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
            }}>{guildInfo.name}</div>
            <div style={{ fontSize: 10, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>Leveling</div>
          </div>
        </div>

        {/* Section label */}
        <div className="dash-hide-narrow" style={{
          fontSize: 10, fontWeight: 'var(--weight-semibold)', color: 'var(--fg-4)',
          padding: '0 var(--space-3)', marginBottom: 'var(--space-2)',
          textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
        }}>Leveling</div>

        {/* Nav items */}
        <nav className="dash-nav" aria-label="Leveling">
          {navItems.map(n => (
            <NavItem key={n.id} icon={n.icon} label={n.label} active={tab === n.id} onClick={() => setTab(n.id)} />
          ))}
        </nav>

        {/* Save button */}
        <div className="dash-save" style={{ marginTop: 'auto', padding: '0 var(--space-1)' }}>
          {saveError && (
            <div role="alert" style={{ marginBottom: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--error)', background: 'var(--error-subtle)', border: '1px solid var(--error-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)' }}>{saveError}</div>
          )}
          <button
            onClick={saveConfig}
            disabled={saving}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)',
              width: '100%', height: 36, borderRadius: 'var(--radius-md)',
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
      </aside>

      {/* Main content */}
      <main className="dash-main" style={{ flex: 1, overflow: 'auto', position: 'relative', zIndex: 1 }}>
        <div style={{ maxWidth: 720 }}>
          {tab === 'leaderboard' && (
            <Panel title="Leaderboard" description="Top 50 members by XP in this server.">
              <SectionCard>
                {leaderboard.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 'var(--space-8) 0' }}>
                    <Trophy size={32} style={{ color: 'var(--fg-4)', marginBottom: 'var(--space-3)' }} />
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-3)' }}>no one's leveled up yet. the journey starts with a message.</div>
                  </div>
                ) : (
                  <div className="table-scroll"><div className="table-inner" style={{ display: 'flex', flexDirection: 'column' }}>
                    {/* Header */}
                    <div style={{
                      display: 'grid', gridTemplateColumns: '48px 1fr 72px 80px 120px',
                      gap: 'var(--space-3)', alignItems: 'center',
                      padding: 'var(--space-2) var(--space-3)',
                      marginBottom: 'var(--space-2)',
                    }}>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-4)', fontWeight: 'var(--weight-semibold)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)' }}>Rank</span>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-4)', fontWeight: 'var(--weight-semibold)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)' }}>User</span>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-4)', fontWeight: 'var(--weight-semibold)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)', textAlign: 'center' }}>Level</span>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-4)', fontWeight: 'var(--weight-semibold)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)', textAlign: 'right' }}>XP</span>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-4)', fontWeight: 'var(--weight-semibold)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)' }}>Progress</span>
                    </div>

                    {leaderboard.map((entry) => {
                      const rankColors = { 1: 'var(--warning)', 2: 'var(--fg-3)', 3: '#cd7f32' }
                      return (
                        <div
                          key={entry.userId}
                          style={{
                            display: 'grid', gridTemplateColumns: '48px 1fr 72px 80px 120px',
                            gap: 'var(--space-3)', alignItems: 'center',
                            padding: 'var(--space-2-5) var(--space-3)',
                            borderRadius: 'var(--radius-md)',
                            borderBottom: '1px solid var(--border-subtle)',
                          }}
                        >
                          {/* Rank */}
                          <span style={{
                            fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)',
                            fontFamily: 'var(--font-mono)',
                            color: rankColors[entry.rank] || 'var(--fg-3)',
                          }}>
                            #{entry.rank}
                          </span>

                          {/* User */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
                            {entry.avatar ? (
                              <img src={entry.avatar} alt="" style={{ width: 24, height: 24, borderRadius: 'var(--radius-sm)', flexShrink: 0 }} />
                            ) : (
                              <div style={{
                                width: 24, height: 24, borderRadius: 'var(--radius-sm)',
                                background: 'var(--surface-3)', flexShrink: 0,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                              }}>
                                <Users size={12} style={{ color: 'var(--fg-4)' }} />
                              </div>
                            )}
                            <span style={{
                              fontSize: 'var(--text-sm)', color: 'var(--fg-1)',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>{entry.username || entry.userId}</span>
                          </div>

                          {/* Level */}
                          <div style={{ textAlign: 'center' }}>
                            <Badge variant="accent">{entry.level}</Badge>
                          </div>

                          {/* XP */}
                          <span style={{
                            fontSize: 'var(--text-xs)', color: 'var(--fg-2)',
                            fontFamily: 'var(--font-mono)', textAlign: 'right',
                          }}>{entry.totalXp.toLocaleString()}</span>

                          {/* Progress */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <ProgressBar current={entry.currentXp} needed={entry.needed} />
                            <span style={{ fontSize: 10, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>
                              {entry.currentXp.toLocaleString()} / {entry.needed.toLocaleString()}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div></div>
                )}
              </SectionCard>
            </Panel>
          )}

          {tab === 'settings' && (
            <Panel title="Settings" description="Configure how the leveling system works.">
              <SectionCard title="General">
                <Toggle
                  label="Enable Leveling"
                  description="Award XP to members for sending messages"
                  checked={config.enabled}
                  onChange={v => updateConfig('enabled', v)}
                />
              </SectionCard>

              <SectionCard title="Level-Up Channel">
                <Input
                  label="Channel ID"
                  value={config.levelup_channel || ''}
                  onChange={e => updateConfig('levelup_channel', e.target.value || null)}
                  placeholder="Leave empty for same channel"
                  hint="Channel where level-up announcements are sent. Leave empty to announce in the same channel the user sent a message."
                  leadingIcon={<Hash size={13} />}
                />
              </SectionCard>

              <SectionCard title="XP Multiplier">
                <div style={{ padding: '0 var(--space-2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
                    <label htmlFor="xp-multiplier" style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--fg-2)' }}>
                      XP Multiplier
                    </label>
                    <Badge variant="accent">{config.xp_multiplier}x</Badge>
                  </div>
                  <input
                    id="xp-multiplier"
                    type="range"
                    min="0.5"
                    max="3"
                    step="0.25"
                    value={config.xp_multiplier}
                    onChange={e => updateConfig('xp_multiplier', parseFloat(e.target.value))}
                    style={{
                      width: '100%', height: 4,
                      appearance: 'none', WebkitAppearance: 'none',
                      background: 'var(--surface-3)', borderRadius: 'var(--radius-full)',
                      outline: 'none', cursor: 'pointer',
                      accentColor: 'var(--accent)',
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-1-5)' }}>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-4)' }}>0.5x</span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-4)' }}>1x</span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-4)' }}>2x</span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-4)' }}>3x</span>
                  </div>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-3)', display: 'block', marginTop: 'var(--space-2)' }}>
                    Multiplier applied to all XP earned. Default is 1x (15-25 XP per message).
                  </span>
                </div>
              </SectionCard>

              <SectionCard title="No-XP Channels">
                <ListInput
                  label="Channel IDs"
                  list={config.no_xp_channels}
                  onList={v => updateConfig('no_xp_channels', v)}
                  placeholder="Channel IDs, comma separated"
                  hint="Members will not earn XP in these channels"
                  leadingIcon={<Hash size={13} />}
                />
              </SectionCard>

              <SectionCard title="No-XP Roles">
                <ListInput
                  label="Role IDs"
                  list={config.no_xp_roles}
                  onList={v => updateConfig('no_xp_roles', v)}
                  placeholder="Role IDs, comma separated"
                  hint="Members with any of these roles will not earn XP"
                  leadingIcon={<Shield size={13} />}
                />
              </SectionCard>
            </Panel>
          )}

          {tab === 'roles' && (
            <Panel title="Role Rewards" description="Automatically assign roles when members reach a level.">
              <SectionCard title="Add Role Reward">
                <div className="dash-stack" style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
                  <Input
                    label="Level"
                    type="number"
                    value={newRoleLevel}
                    onChange={e => setNewRoleLevel(e.target.value)}
                    placeholder="5"
                    style={{ width: 100 }}
                  />
                  <Input
                    label="Role ID"
                    value={newRoleId}
                    onChange={e => setNewRoleId(e.target.value)}
                    placeholder="Role ID"
                    leadingIcon={<Shield size={13} />}
                    style={{ flex: 1 }}
                  />
                  <Button
                    variant="primary"
                    size="md"
                    onClick={addRoleReward}
                    leftIcon={<Plus size={13} />}
                    style={{ flexShrink: 0 }}
                  >
                    Add
                  </Button>
                </div>
              </SectionCard>

              <SectionCard title="Active Rewards">
                {(!config.level_roles || config.level_roles.length === 0) ? (
                  <div style={{ textAlign: 'center', padding: 'var(--space-6) 0' }}>
                    <Award size={28} style={{ color: 'var(--fg-4)', marginBottom: 'var(--space-2)' }} />
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-3)' }}>no role rewards yet. give people something to work toward.</div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {config.level_roles.map((reward) => (
                      <div
                        key={reward.level}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: 'var(--space-2-5) var(--space-3)', borderRadius: 'var(--radius-md)',
                          background: 'var(--surface-hover)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                          <Badge variant="accent">Level {reward.level}</Badge>
                          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-3)' }}>awards</span>
                          <code style={{
                            fontSize: 'var(--text-xs)', color: 'var(--fg-1)',
                            background: 'var(--surface-2)', padding: '2px 8px',
                            borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)',
                            border: '1px solid var(--border-subtle)',
                          }}>{reward.roleId}</code>
                        </div>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => removeRoleReward(reward.level)}
                          leftIcon={<Trash2 size={12} />}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </Panel>
          )}
        </div>
      </main>
    </div>
  )
}
