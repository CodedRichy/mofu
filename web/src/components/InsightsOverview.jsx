import { useState, useEffect, useMemo } from 'react'
import { ArrowUpRight, Server } from 'lucide-react'
import { api } from '../lib/api'
import { Kpi, RangeToggle, BarChart, DualLine, Spark, fmt, deltaText } from './charts'

// Plain-worded flags computed from the numbers only. Returns [] when nothing stands out.
export function attention(servers) {
  const out = []
  for (const s of servers) {
    if (s.messages !== null && s.previousMessages !== null && s.previousMessages >= 50 && s.messages <= s.previousMessages * 0.6) {
      const pct = Math.round((1 - s.messages / s.previousMessages) * 100)
      out.push({ guildId: s.guildId, text: `${s.name}: messages are down ${pct}% (${fmt(s.messages)} vs ${fmt(s.previousMessages)} before).` })
    }
    if (s.modActions >= 5 && s.previousModActions !== null && s.modActions >= s.previousModActions * 2 + 3) {
      out.push({ guildId: s.guildId, text: `${s.name}: ${fmt(s.modActions)} mod actions, up from ${fmt(s.previousModActions)} before.` })
    }
  }
  return out.slice(0, 5)
}

function ServerCard({ s, onOpen }) {
  return (
    <button type="button" className="ins-server" onClick={onOpen} aria-label={`Open ${s.name}`}>
      <div className="ins-server-top">
        {s.icon ? (
          <img src={`https://cdn.discordapp.com/icons/${s.guildId}/${s.icon}.png?size=64`} alt="" width="40" height="40" style={{ borderRadius: 'var(--radius-lg)', flexShrink: 0, border: '1px solid var(--border-subtle)' }} />
        ) : (
          <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-lg)', background: 'var(--accent-subtle)', border: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Server size={16} style={{ color: 'var(--fg-2)' }} aria-hidden="true" />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ins-server-name">{s.name}</div>
          <div className="ins-server-sub">{s.members != null ? `${fmt(s.members)} members` : ''}</div>
        </div>
        <span className="ins-open">open <ArrowUpRight size={13} aria-hidden="true" /></span>
      </div>
      {s.counted ? <Spark values={s.series} label={`${s.name} messages per day`} /> : <div className="ins-spark" aria-hidden="true" />}
      <div className="ins-server-nums">
        <div className="ins-num"><b>{s.counted ? fmt(s.messages) : 'n/a'}</b><span>messages</span></div>
        <div className="ins-num"><b>{s.joins === null ? 'n/a' : `${s.joins - s.leaves > 0 ? '+' : ''}${s.joins - s.leaves}`}</b><span>net members</span></div>
        <div className="ins-num"><b>{fmt(s.modActions)}</b><span>mod actions</span></div>
      </div>
    </button>
  )
}

// First screen of /dashboard: one request, totals across every server the signed-in user manages.
export function InsightsOverview({ token, onOpen }) {
  const [days, setDays] = useState(7)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const r = await api(`/insights/overview?days=${days}`, token, { noRedirect: true })
      if (cancelled) return
      if (r.ok) { setData(r.data); setError(null) } else setError(r.error)
    })()
    return () => { cancelled = true }
  }, [token, days])

  const flags = useMemo(() => (data ? attention(data.perServer) : []), [data])

  if (error && !data) return <div className="ins-empty" role="alert">{error}</div>
  if (!data) return <div className="ins-empty" role="status">reading the room..</div>

  const { totals: t, previous: p, counters, series, perServer, notes } = data
  const net = t.joins === null ? null : t.joins - t.leaves
  const prevNet = p.joins === null ? null : p.joins - p.leaves

  return (
    <div className="ins-stack">
      <div className="ins-head">
        <p className="ins-line">across <b>{perServer.length} {perServer.length === 1 ? 'server' : 'servers'}</b>, last <b>{data.range?.days ?? days} days</b>.</p>
        <RangeToggle days={days} onChange={setDays} />
      </div>

      <div className="ins-kpis">
        <Kpi label="Members" value={t.members} sub={`in ${perServer.length} ${perServer.length === 1 ? 'server' : 'servers'}`} />
        <Kpi label="Messages" value={t.messages} prev={p.messages} />
        <Kpi label="Net members" value={net} prev={prevNet} sub={t.joins === null ? '' : `${fmt(t.joins)} joined, ${fmt(t.leaves)} left`} />
        <Kpi label="Mod actions" value={t.modActions} prev={p.modActions} />
        <Kpi label="Active chatters" value={t.activeChatters} sub="members who earned xp" />
      </div>

      {flags.length > 0 && (
        <section className="ins-card ins-attn" aria-label="Worth a look">
          <h3>Worth a look</h3>
          <ul>
            {flags.map((f, i) => (
              <li key={i}>{f.text} <button type="button" onClick={() => onOpen(f.guildId)}>open</button></li>
            ))}
          </ul>
        </section>
      )}

      {counters.available ? (
        <div className="ins-grid2">
          <div className="ins-card">
            <h3>Messages per day</h3>
            <div className="ins-card-sub">all your servers combined</div>
            <BarChart data={series.messages} label={`Messages per day across all servers, last ${data.range.days} days`} />
          </div>
          <div className="ins-card">
            <h3>Joins vs leaves</h3>
            <div className="ins-card-sub">{net === null ? '' : `net ${net > 0 ? '+' : ''}${net} members`}{deltaText(net, prevNet) ? `, ${deltaText(net, prevNet)}` : ''}</div>
            <DualLine a={series.joins} b={series.leaves} aName="joined" bName="left" label={`Joins and leaves per day across all servers, last ${data.range.days} days`} />
          </div>
        </div>
      ) : (
        <div className="ins-card"><div className="ins-empty" style={{ marginTop: 0 }}>no activity counts yet. charts appear once your servers have been used for a day or so.</div></div>
      )}

      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-md)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-2)' }}>Your servers</h2>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>{perServer.length}</span>
        </div>
        {perServer.length === 0
          ? <div className="ins-empty" style={{ marginTop: 0 }}>no servers found. make sure the bot is in a server where you have Manage Server.</div>
          : <div className="ins-servers">{perServer.map((s) => <ServerCard key={s.guildId} s={s} onOpen={() => onOpen(s.guildId)} />)}</div>}
      </div>

      {notes.length > 0 && <ul className="ins-notes" aria-label="About this data">{notes.map((n) => <li key={n}>{n}</li>)}</ul>}
    </div>
  )
}
