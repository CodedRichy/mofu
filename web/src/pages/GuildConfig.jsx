import { useState, useEffect, useId } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Save, Shield, Bot, Bell, Check, Settings, Hash, MessageSquare, Server, Sparkles, ExternalLink, Zap, Terminal, Trash2, Plus, AlertTriangle, Coins, TrendingUp } from 'lucide-react'
import { NOISE_SVG } from '../components/Layout'
import { api } from '../lib/api'
import { useToken } from '../lib/auth'
import { useListText } from '../lib/listText'

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

function Field({ label, value, onChange, type = 'text', hint, icon: Icon }) {
  const [focused, setFocused] = useState(false)
  const id = useId()
  return (
    <div style={{ marginBottom: 'var(--space-5)' }}>
      <label htmlFor={id} style={{
        display: 'block', fontSize: 'var(--text-xs)', color: 'var(--fg-2)',
        marginBottom: 'var(--space-1-5)', fontWeight: 'var(--weight-medium)',
        letterSpacing: '0.01em',
      }}>{label}</label>
      <div style={{
        display: 'flex', alignItems: 'center', borderRadius: 'var(--radius-md)',
        border: `1px solid ${focused ? 'var(--border-focus)' : 'var(--border-default)'}`,
        background: 'var(--surface-1)',
        boxShadow: focused ? '0 0 0 3px rgba(255, 255, 255, 0.05)' : 'none',
        transition: 'border-color 100ms var(--ease-default), box-shadow 100ms var(--ease-default)',
        overflow: 'hidden',
      }}>
        {Icon && <span style={{ display: 'flex', padding: '0 0 0 var(--space-3)', color: 'var(--fg-4)' }}><Icon size={13} /></span>}
        {type === 'textarea' ? (
          <textarea
            id={id}
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={{
              width: '100%', minHeight: 80, padding: 'var(--space-2-5) var(--space-3)',
              background: 'transparent', border: 'none',
              color: 'var(--fg-1)', fontSize: 'var(--text-sm)',
              resize: 'vertical', fontFamily: 'var(--font-body)',
              outline: 'none', lineHeight: 1.6,
            }}
          />
        ) : (
          <input
            id={id}
            type={type}
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={{
              width: '100%', height: 'var(--input-height-md)', padding: '0 var(--space-3)',
              background: 'transparent', border: 'none',
              color: 'var(--fg-1)', fontSize: 'var(--text-sm)',
              outline: 'none', fontFamily: 'var(--font-body)',
            }}
          />
        )}
      </div>
      {hint && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-3)', marginTop: 'var(--space-1-5)', display: 'block' }}>{hint}</span>}
    </div>
  )
}

// Text box for a list value: raw text stays local so "a, b," and trailing newlines survive typing.
function ListField({ label, list, onList, mode = 'comma', hint }) {
  const [text, onText] = useListText(list, onList, mode)
  return <Field label={label} value={text} onChange={onText} type="textarea" hint={hint} />
}

function Notice({ children }) {
  if (!children) return null
  return (
    <div role="alert" style={{
      fontSize: 'var(--text-xs)', color: 'var(--error)', background: 'var(--error-subtle)',
      border: '1px solid var(--error-border)', borderRadius: 'var(--radius-md)',
      padding: 'var(--space-2) var(--space-3)', lineHeight: 1.5,
    }}>{children}</div>
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

function Divider() {
  return <div style={{ height: 1, background: 'var(--border-subtle)', margin: 'var(--space-1) 0' }} />
}

export function GuildConfig() {
  const { guildId } = useParams()
  const navigate = useNavigate()
  const token = useToken()
  const [cfg, setCfg] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [tab, setTab] = useState('general')

  // Automod state
  const [automod, setAutomod] = useState(null)
  const [automodSaving, setAutomodSaving] = useState(false)
  const [automodError, setAutomodError] = useState(null)

  // Custom commands state
  const [customCmds, setCustomCmds] = useState([])
  const [newCmdName, setNewCmdName] = useState('')
  const [newCmdResponse, setNewCmdResponse] = useState('')
  const [cmdCreating, setCmdCreating] = useState(false)
  const [deletingCmd, setDeletingCmd] = useState(null) // name of cmd pending confirmation
  const [cmdError, setCmdError] = useState(null)

  useEffect(() => {
    if (!token) { navigate('/dashboard'); return }
    api(`/guilds/${guildId}/config`, token).then(res => {
      if (!res.ok) navigate('/dashboard')
      else setCfg(res.data)
    })
  }, [guildId])

  // Fetch automod config when tab switches to automod
  useEffect(() => {
    if (tab === 'automod' && token && !automod) {
      setAutomodError(null)
      // On failure leave automod null: seeding {} here would let Save overwrite the real settings with nothing.
      api(`/guilds/${guildId}/automod-config`, token).then(res => {
        if (res.ok) setAutomod(res.data || {})
        else setAutomodError(res.error)
      })
    }
  }, [tab, guildId])

  // Fetch custom commands when tab switches to commands
  useEffect(() => {
    if (tab === 'commands' && token) {
      api(`/guilds/${guildId}/custom-commands`, token).then(res => {
        if (res.ok) { setCustomCmds(res.data || []); setCmdError(null) }
        else setCmdError(res.error)
      })
    }
  }, [tab, guildId])

  if (!cfg) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid var(--border-default)', borderTopColor: 'var(--accent)', animation: 'spin 0.7s linear infinite' }} />
      </div>
    )
  }

  function update(key, value) {
    setCfg(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  function flashSaved() {
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  async function save() {
    setSaving(true)
    setSaveError(null)
    try {
      const { name, icon, memberCount, ...rest } = cfg
      const res = await api(`/guilds/${guildId}/config`, token, { method: 'PATCH', body: JSON.stringify(rest) })
      if (res.ok) flashSaved()
      else setSaveError(res.error)
    } finally {
      setSaving(false)
    }
  }

  function updateAutomod(key, value) {
    setAutomod(prev => ({ ...prev, [key]: value }))
  }

  async function saveAutomod() {
    setAutomodSaving(true)
    setAutomodError(null)
    try {
      const res = await api(`/guilds/${guildId}/automod-config`, token, { method: 'PATCH', body: JSON.stringify(automod) })
      if (res.ok) flashSaved()
      else setAutomodError(res.error)
    } finally {
      setAutomodSaving(false)
    }
  }

  async function createCustomCmd() {
    if (!newCmdName.trim() || !newCmdResponse.trim()) return
    setCmdCreating(true)
    setCmdError(null)
    try {
      const res = await api(`/guilds/${guildId}/custom-commands`, token, {
        method: 'POST',
        body: JSON.stringify({ name: newCmdName.trim().toLowerCase(), response: newCmdResponse.trim() }),
      })
      if (!res.ok) { setCmdError(res.error); return }   // keep the form so nothing typed is lost
      const list = await api(`/guilds/${guildId}/custom-commands`, token)
      if (list.ok) setCustomCmds(list.data || [])
      setNewCmdName('')
      setNewCmdResponse('')
    } finally {
      setCmdCreating(false)
    }
  }

  async function deleteCustomCmd(name) {
    if (deletingCmd !== name) { setDeletingCmd(name); return }
    setCmdError(null)
    const res = await api(`/guilds/${guildId}/custom-commands/${encodeURIComponent(name)}`, token, { method: 'DELETE' })
    if (res.ok) setCustomCmds(prev => prev.filter(c => c.name !== name))
    else setCmdError(res.error)
    setDeletingCmd(null)
  }

  const navItems = [
    { id: 'general', label: 'General', icon: Settings },
    { id: 'welcome', label: 'Welcome', icon: MessageSquare },
    { id: 'moderation', label: 'Moderation', icon: Shield },
    { id: 'automod', label: 'Automod', icon: Zap },
    { id: 'logging', label: 'Logging', icon: Bell },
    { id: 'commands', label: 'Custom Commands', icon: Terminal },
    { id: 'ai', label: 'AI', icon: Bot },
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
          onClick={() => navigate('/dashboard')}
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
          <span>All servers</span>
        </button>

        {/* Server identity */}
        <div className="dash-hide-narrow" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2-5)', padding: '0 var(--space-2)', marginBottom: 'var(--space-6)' }}>
          {cfg.icon ? (
            <img src={cfg.icon} alt="" style={{ width: 30, height: 30, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }} />
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
            }}>{cfg.name}</div>
            <div style={{ fontSize: 10, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>{cfg.memberCount?.toLocaleString()} members</div>
          </div>
        </div>

        {/* Section label */}
        <div className="dash-hide-narrow" style={{
          fontSize: 10, fontWeight: 'var(--weight-semibold)', color: 'var(--fg-4)',
          padding: '0 var(--space-3)', marginBottom: 'var(--space-2)',
          textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
        }}>Settings</div>

        {/* Nav items */}
        <nav className="dash-nav" aria-label="Server settings">
          {navItems.map(n => (
            <NavItem key={n.id} icon={n.icon} label={n.label} active={tab === n.id} onClick={() => setTab(n.id)} />
          ))}
        </nav>

        {/* Divider */}
        <div className="dash-hide-narrow" style={{ height: 1, background: 'var(--border-subtle)', margin: 'var(--space-4) var(--space-2)' }} />

        {/* Management section label */}
        <div className="dash-hide-narrow" style={{
          fontSize: 10, fontWeight: 'var(--weight-semibold)', color: 'var(--fg-4)',
          padding: '0 var(--space-3)', marginBottom: 'var(--space-2)',
          textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
        }}>Management</div>

        {/* Management nav links */}
        <nav className="dash-nav" aria-label="Management">
          {[
            { to: `/dashboard/${guildId}/moderation`, label: 'Moderation', icon: Shield },
            { to: `/dashboard/${guildId}/economy`, label: 'Economy', icon: Coins },
            { to: `/dashboard/${guildId}/leveling`, label: 'Leveling', icon: TrendingUp },
          ].map(n => (
            <Link key={n.to} to={n.to} style={{ textDecoration: 'none' }}>
              <NavItem icon={n.icon} label={n.label} active={false} onClick={() => {}} />
            </Link>
          ))}
        </nav>

        {/* Save button */}
        <div className="dash-save" style={{ marginTop: 'auto', padding: '0 var(--space-1)' }}>
          {saveError && <div style={{ marginBottom: 'var(--space-2)' }}><Notice>{saveError}</Notice></div>}
          <button
            onClick={save}
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
        <div style={{ maxWidth: 640 }}>
          {tab === 'general' && (
            <Panel title="General" description="the basics. prefix, identity, how sonder shows up.">
              <SectionCard title="Prefix">
                <Field label="Command Prefix" value={cfg.prefix} onChange={v => update('prefix', v)} hint="Default: ;" icon={Hash} />
              </SectionCard>
              <SectionCard title="Features">
                <Toggle label="Leveling System" description="Award XP for messages and track levels" checked={cfg.leveling !== false} onChange={v => update('leveling', v)} />
                <Divider />
                <Toggle label="Anti-Spam" description="Auto-timeout users sending 5+ messages in 3 seconds" checked={!!cfg.antispam} onChange={v => update('antispam', v)} />
                <Divider />
                <Toggle label="Anti-Link" description="Delete messages containing links from non-moderators" checked={!!cfg.antilink} onChange={v => update('antilink', v)} />
              </SectionCard>
            </Panel>
          )}

          {tab === 'welcome' && (
            <Panel title="Welcome & Goodbye" description="first impressions matter. make people feel seen.">
              <SectionCard title="Welcome">
                <Field label="Channel ID" value={cfg.welcome_channel} onChange={v => update('welcome_channel', v || null)} icon={Hash} hint="Channel where welcome messages are sent" />
                <Field label="Message" value={cfg.welcome_message} onChange={v => update('welcome_message', v || null)} type="textarea" hint="Variables: {user}, {server}, {membercount}" />
                <Toggle label="Canvas Image Card" description="Generate a welcome card with the user's avatar" checked={!!cfg.welcome_card} onChange={v => update('welcome_card', v)} />
              </SectionCard>
              <SectionCard title="Goodbye">
                <Field label="Channel ID" value={cfg.goodbye_channel} onChange={v => update('goodbye_channel', v || null)} icon={Hash} />
                <Field label="Message" value={cfg.goodbye_message} onChange={v => update('goodbye_message', v || null)} type="textarea" />
                <Toggle label="Canvas Image Card" description="Generate a goodbye card" checked={!!cfg.goodbye_card} onChange={v => update('goodbye_card', v)} />
              </SectionCard>
            </Panel>
          )}

          {tab === 'moderation' && (
            <Panel title="Moderation" description="protection that thinks, not just reacts.">
              <SectionCard title="Protection">
                <Toggle label="Anti-Spam" description="Automatically timeout and purge messages from spammers" checked={!!cfg.antispam} onChange={v => update('antispam', v)} />
                <Divider />
                <Toggle label="Anti-Link" description="Block links from non-moderators" checked={!!cfg.antilink} onChange={v => update('antilink', v)} />
              </SectionCard>
              <SectionCard title="Word Filter">
                <ListField label="Blocked Words" list={cfg.word_filter} onList={v => update('word_filter', v)} hint="Comma-separated list of blocked words" />
                {cfg.word_filter?.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1-5)', marginTop: 'var(--space-3)' }}>
                    {cfg.word_filter.map((w, i) => (
                      <span key={`${w}-${i}`} style={{
                        fontSize: 'var(--text-xs)', padding: '3px 8px',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--error-subtle)',
                        border: '1px solid var(--error-border)',
                        color: 'var(--error)',
                        fontFamily: 'var(--font-mono)',
                      }}>{w}</span>
                    ))}
                  </div>
                )}
              </SectionCard>
            </Panel>
          )}

          {tab === 'logging' && (
            <Panel title="Logging" description="sonder remembers everything. choose what gets written down.">
              <SectionCard title="Channels">
                <Field label="Modlog Channel" value={cfg.modlog_channel} onChange={v => update('modlog_channel', v || null)} icon={Hash} hint="Mod actions (ban, kick, mute, warn) posted here" />
                <Field label="Audit Log Channel" value={cfg.audit_log_channel} onChange={v => update('audit_log_channel', v || null)} icon={Hash} hint="Server events (role changes, channel edits, deletions)" />
                <Field label="Level-up Channel" value={cfg.levelup_channel} onChange={v => update('levelup_channel', v || null)} icon={Hash} hint="Leave empty to announce in the same channel" />
              </SectionCard>
            </Panel>
          )}

          {tab === 'ai' && (
            <Panel title="AI Features" description="the part that makes sonder, sonder.">
              <SectionCard>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 'var(--radius-lg)',
                    background: 'var(--accent-subtle)',
                    border: '1px solid var(--border-accent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Sparkles size={16} style={{ color: 'var(--accent)' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-1)' }}>AI Commands</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-3)' }}>Qwen3.8 27B via Groq</div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {[
                    { cmd: '/ask', desc: 'Ask Sonder AI any question' },
                    { cmd: '/summarize', desc: 'Summarize recent channel conversation' },
                    { cmd: '/sentiment', desc: 'Analyze message sentiment in channel' },
                  ].map(({ cmd, desc }) => (
                    <div key={cmd} style={{
                      display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                      padding: 'var(--space-2-5) var(--space-3)', borderRadius: 'var(--radius-md)',
                      background: 'var(--surface-hover)',
                    }}>
                      <code style={{
                        fontSize: 'var(--text-xs)', color: 'var(--accent)',
                        background: 'var(--accent-subtle)', padding: '2px 6px',
                        borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)',
                        fontWeight: 'var(--weight-medium)',
                      }}>{cmd}</code>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-3)' }}>{desc}</span>
                    </div>
                  ))}
                </div>
              </SectionCard>

              <SectionCard style={{ borderColor: 'var(--border-accent)', background: 'var(--accent-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                  <Bot size={16} style={{ color: 'var(--accent)', marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-2)', lineHeight: 1.7 }}>
                      AI features require a <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>GROQ_API_KEY</span> in
                      your bot's environment. Get a free key at{' '}
                      <a href="https://console.groq.com" target="_blank" rel="noreferrer" style={{
                        color: 'var(--accent)', textDecoration: 'none',
                        borderBottom: '1px solid var(--border-accent)',
                      }}>
                        console.groq.com <ExternalLink size={10} style={{ display: 'inline', verticalAlign: 'middle' }} />
                      </a>
                    </p>
                  </div>
                </div>
              </SectionCard>
            </Panel>
          )}

          {tab === 'automod' && (
            <Panel title="Automod" description="automated protection. sonder watches so you don't have to.">
              {!automod && automodError ? (
                <Notice>{"Couldn't load automod settings. " + automodError}</Notice>
              ) : !automod ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-8)' }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid var(--border-default)', borderTopColor: 'var(--accent)', animation: 'spin 0.7s linear infinite' }} />
                </div>
              ) : (
                <>
                  <SectionCard title="Anti-Spam">
                    <Toggle
                      label="Enable Anti-Spam"
                      description="Automatically punish users who send messages too quickly"
                      checked={!!automod.antispam}
                      onChange={v => updateAutomod('antispam', v)}
                    />
                    {automod.antispam && (
                      <div style={{ marginTop: 'var(--space-4)', padding: '0 var(--space-4)' }}>
                        <div style={{ marginBottom: 'var(--space-4)' }}>
                          <label style={{
                            display: 'block', fontSize: 'var(--text-xs)', color: 'var(--fg-2)',
                            marginBottom: 'var(--space-1-5)', fontWeight: 'var(--weight-medium)',
                          }}>Message Threshold <span style={{ color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>({automod.antispam_threshold || 5} messages in 3s)</span></label>
                          <input
                            type="range" min={3} max={10} step={1}
                            value={automod.antispam_threshold || 5}
                            onChange={e => updateAutomod('antispam_threshold', parseInt(e.target.value))}
                            style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
                          />
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--fg-4)', marginTop: 2 }}>
                            <span>3 (strict)</span>
                            <span>10 (lenient)</span>
                          </div>
                        </div>
                        <div style={{ marginBottom: 'var(--space-4)' }}>
                          <label style={{
                            display: 'block', fontSize: 'var(--text-xs)', color: 'var(--fg-2)',
                            marginBottom: 'var(--space-1-5)', fontWeight: 'var(--weight-medium)',
                          }}>Action</label>
                          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                            {['mute', 'kick', 'ban'].map(action => (
                              <button
                                key={action}
                                onClick={() => updateAutomod('antispam_action', action)}
                                style={{
                                  flex: 1, height: 34, borderRadius: 'var(--radius-md)', cursor: 'pointer',
                                  background: (automod.antispam_action || 'mute') === action ? 'var(--accent-subtle)' : 'var(--surface-1)',
                                  border: (automod.antispam_action || 'mute') === action ? '1px solid var(--border-accent)' : '1px solid var(--border-default)',
                                  color: (automod.antispam_action || 'mute') === action ? 'var(--accent)' : 'var(--fg-3)',
                                  fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)',
                                  textTransform: 'capitalize', fontFamily: 'var(--font-body)',
                                  transition: 'all 120ms var(--ease-default)',
                                }}
                              >{action}</button>
                            ))}
                          </div>
                        </div>
                        {(automod.antispam_action || 'mute') === 'mute' && (
                          <Field
                            label="Mute Duration"
                            value={automod.antispam_duration || '10m'}
                            onChange={v => updateAutomod('antispam_duration', v)}
                            hint="Examples: 5m, 1h, 1d"
                          />
                        )}
                      </div>
                    )}
                  </SectionCard>

                  <SectionCard title="Anti-Link">
                    <Toggle
                      label="Enable Anti-Link"
                      description="Delete messages containing links from non-moderators"
                      checked={!!automod.antilink}
                      onChange={v => updateAutomod('antilink', v)}
                    />
                    {automod.antilink && (
                      <div style={{ marginTop: 'var(--space-4)', padding: '0 var(--space-4)' }}>
                        <ListField
                          label="Whitelisted Domains"
                          list={automod.antilink_whitelist}
                          onList={v => updateAutomod('antilink_whitelist', v)}
                          mode="line"
                          hint="One domain per line (e.g. youtube.com, discord.gg)"
                        />
                      </div>
                    )}
                  </SectionCard>

                  <SectionCard title="Word Filter">
                    <Toggle
                      label="Enable Word Filter"
                      description="Delete messages containing blocked words"
                      checked={!!automod.word_filter}
                      onChange={v => updateAutomod('word_filter', v)}
                    />
                    {automod.word_filter && (
                      <div style={{ marginTop: 'var(--space-4)', padding: '0 var(--space-4)' }}>
                        <ListField
                          label="Blocked Words"
                          list={automod.word_filter_list}
                          onList={v => updateAutomod('word_filter_list', v)}
                          hint="Comma-separated list of words to block"
                        />
                        {(automod.word_filter_list || []).length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1-5)', marginTop: 'var(--space-2)' }}>
                            {automod.word_filter_list.map((w, i) => (
                              <span key={`${w}-${i}`} style={{
                                fontSize: 'var(--text-xs)', padding: '3px 8px',
                                borderRadius: 'var(--radius-sm)',
                                background: 'var(--error-subtle)',
                                border: '1px solid var(--error-border)',
                                color: 'var(--error)',
                                fontFamily: 'var(--font-mono)',
                              }}>{w}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </SectionCard>

                  {automodError && <Notice>{automodError}</Notice>}
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      onClick={saveAutomod}
                      disabled={automodSaving}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                        height: 36, padding: '0 var(--space-5)', borderRadius: 'var(--radius-md)',
                        background: 'var(--accent)', color: 'var(--accent-fg)',
                        fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)',
                        fontFamily: 'var(--font-body)', cursor: automodSaving ? 'wait' : 'pointer',
                        border: '1px solid rgba(0,0,0,0.2)',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)',
                        opacity: automodSaving ? 0.7 : 1,
                        transition: 'all 160ms var(--ease-default)',
                      }}
                    >
                      <Save size={13} />
                      {automodSaving ? 'Saving...' : 'Save Automod'}
                    </button>
                  </div>
                </>
              )}
            </Panel>
          )}

          {tab === 'commands' && (
            <Panel title="Custom Commands" description="your words, sonder's voice.">
              <Notice>{cmdError}</Notice>
              <SectionCard title="Add Command">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
                    <div style={{ flex: '0 1 180px', minWidth: 0 }}>
                      <label htmlFor="cmd-name" style={{
                        display: 'block', fontSize: 'var(--text-xs)', color: 'var(--fg-2)',
                        marginBottom: 'var(--space-1-5)', fontWeight: 'var(--weight-medium)',
                      }}>Command Name</label>
                      <div style={{
                        display: 'flex', alignItems: 'center', borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-default)', background: 'var(--surface-1)',
                        overflow: 'hidden',
                      }}>
                        <span style={{ padding: '0 0 0 var(--space-2-5)', color: 'var(--fg-4)', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)', userSelect: 'none' }}>;</span>
                        <input
                          id="cmd-name"
                          value={newCmdName}
                          onChange={e => setNewCmdName(e.target.value.replace(/\s/g, '').slice(0, 32))}
                          placeholder="hello"
                          style={{
                            width: '100%', height: 'var(--input-height-md)', padding: '0 var(--space-2-5)',
                            background: 'transparent', border: 'none',
                            color: 'var(--fg-1)', fontSize: 'var(--text-sm)',
                            outline: 'none', fontFamily: 'var(--font-mono)',
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="cmd-response" style={{
                      display: 'block', fontSize: 'var(--text-xs)', color: 'var(--fg-2)',
                      marginBottom: 'var(--space-1-5)', fontWeight: 'var(--weight-medium)',
                    }}>Response</label>
                    <textarea
                      id="cmd-response"
                      value={newCmdResponse}
                      onChange={e => setNewCmdResponse(e.target.value.slice(0, 2000))}
                      placeholder="Hello {user}! Welcome to {server}."
                      style={{
                        width: '100%', minHeight: 80, padding: 'var(--space-2-5) var(--space-3)',
                        background: 'var(--surface-1)', borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-default)',
                        color: 'var(--fg-1)', fontSize: 'var(--text-sm)',
                        resize: 'vertical', fontFamily: 'var(--font-body)',
                        outline: 'none', lineHeight: 1.6,
                      }}
                    />
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-4)', marginTop: 'var(--space-1)', display: 'block' }}>
                      Variables: <code style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{'{user}'}</code> <code style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{'{server}'}</code>
                    </span>
                  </div>
                  <div>
                    <button
                      onClick={createCustomCmd}
                      disabled={cmdCreating || !newCmdName.trim() || !newCmdResponse.trim()}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                        height: 34, padding: '0 var(--space-4)', borderRadius: 'var(--radius-md)',
                        background: (!newCmdName.trim() || !newCmdResponse.trim()) ? 'var(--surface-3)' : 'var(--accent)',
                        color: (!newCmdName.trim() || !newCmdResponse.trim()) ? 'var(--fg-4)' : 'var(--accent-fg)',
                        fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)',
                        fontFamily: 'var(--font-body)',
                        cursor: (!newCmdName.trim() || !newCmdResponse.trim() || cmdCreating) ? 'not-allowed' : 'pointer',
                        border: '1px solid rgba(0,0,0,0.15)',
                        transition: 'all 160ms var(--ease-default)',
                        opacity: cmdCreating ? 0.7 : 1,
                      }}
                    >
                      <Plus size={13} />
                      {cmdCreating ? 'Creating...' : 'Add Command'}
                    </button>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title={`Commands (${customCmds.length})`}>
                {customCmds.length === 0 ? (
                  <div style={{
                    textAlign: 'center', padding: 'var(--space-8) var(--space-4)',
                    color: 'var(--fg-4)', fontSize: 'var(--text-sm)',
                  }}>
                    <Terminal size={24} style={{ margin: '0 auto var(--space-2)', display: 'block', opacity: 0.4 }} />
                    no custom commands. want to make one?
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {/* Table header */}
                    <div style={{
                      display: 'grid', gridTemplateColumns: '120px 1fr 80px',
                      gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)',
                      fontSize: 10, fontWeight: 'var(--weight-semibold)', color: 'var(--fg-4)',
                      textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}>
                      <span>Name</span>
                      <span>Response</span>
                      <span style={{ textAlign: 'right' }}>Action</span>
                    </div>
                    {customCmds.map(cmd => (
                      <div
                        key={cmd.name}
                        style={{
                          display: 'grid', gridTemplateColumns: '120px 1fr 80px',
                          gap: 'var(--space-3)', padding: 'var(--space-2-5) var(--space-3)',
                          alignItems: 'center', borderBottom: '1px solid var(--border-subtle)',
                          fontSize: 'var(--text-sm)',
                        }}
                      >
                        <code style={{
                          color: 'var(--accent)', fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>;{cmd.name}</code>
                        <span style={{
                          color: 'var(--fg-3)', overflow: 'hidden',
                          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          fontSize: 'var(--text-xs)',
                        }}>{cmd.response}</span>
                        <div style={{ textAlign: 'right' }}>
                          <button
                            onClick={() => deleteCustomCmd(cmd.name)}
                            onMouseLeave={() => { if (deletingCmd === cmd.name) setDeletingCmd(null) }}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)',
                              height: 28, padding: '0 var(--space-2-5)', borderRadius: 'var(--radius-sm)',
                              background: deletingCmd === cmd.name ? 'var(--error)' : 'transparent',
                              border: deletingCmd === cmd.name ? '1px solid var(--error)' : '1px solid var(--border-default)',
                              color: deletingCmd === cmd.name ? 'var(--error-fg)' : 'var(--fg-3)',
                              fontSize: 'var(--text-xs)', cursor: 'pointer',
                              fontFamily: 'var(--font-body)',
                              transition: 'all 120ms var(--ease-default)',
                            }}
                          >
                            {deletingCmd === cmd.name ? (
                              <><AlertTriangle size={11} /> Confirm</>
                            ) : (
                              <Trash2 size={11} />
                            )}
                          </button>
                        </div>
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
