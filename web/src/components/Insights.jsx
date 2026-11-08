import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { Kpi, RangeToggle, BarChart, DualLine, RankRows, fmt } from './charts'

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const dayName = (iso) => DAY_NAMES[new Date(`${iso}T00:00:00Z`).getUTCDay()]

// Per-server insights: aggregates the bot keeps (daily counters, mod cases, command counts). Nothing here is
// per-person or per-message. Anything not counted shows as "not counted", never as a zero.
export function Insights({ guildId, token }) {
  const [days, setDays] = useState(7)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const r = await api(`/guilds/${guildId}/insights?days=${days}`, token, { noRedirect: true })
      if (cancelled) return
      if (r.ok) { setData(r.data); setError(null) } else setError(r.error)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [guildId, token, days])

  const head = (
    <div className="ins-head">
      <p className="ins-line">what happened here over the last <b>{days} days</b>.</p>
      <RangeToggle days={days} onChange={setDays} />
    </div>
  )

  if (error && !data) return <div className="ins-stack">{head}<div className="ins-empty" role="alert">{error}</div></div>
  if (!data) return <div className="ins-stack">{head}<div className="ins-empty" role="status">{loading ? 'reading the room..' : 'nothing yet.'}</div></div>

  const { totals: t, previous: p, counters, series, topCommands, modByType, members, busiest, notes } = data
  const chartsFor = counters.available
  const modAny = t.modActions > 0

  return (
    <div className="ins-stack" aria-busy={loading}>
      {head}

      <div className="ins-kpis">
        <Kpi label="Messages" value={t.messages} prev={p.messages} />
        <Kpi label="Joined" value={t.joins} prev={p.joins} />
        <Kpi label="Left" value={t.leaves} prev={p.leaves} />
        <Kpi label="Mod actions" value={t.modActions} prev={p.modActions} />
        <Kpi label="Commands used" value={t.commands} prev={p.commands} />
        <Kpi label="Active chatters" value={members.activeChatters} sub={members.total != null ? `of ${fmt(members.total)} members` : ''} />
      </div>

      <div className="ins-card">
        <h3>Messages per day</h3>
        <div className="ins-card-sub">human messages, bots left out. only a count per day is kept.</div>
        {chartsFor ? (
          <>
            <BarChart data={series.messages} label={`Messages per day, last ${data.range.days} days`} />
            {busiest && <p className="ins-line" style={{ marginTop: 'var(--space-3)' }}>busiest day: <b>{dayName(busiest.date)} {busiest.date}</b> with {fmt(busiest.count)} messages.</p>}
          </>
        ) : <div className="ins-empty">no message counts yet. they start filling in as people talk.</div>}
      </div>

      <div className="ins-grid2">
        <div className="ins-card">
          <h3>Joins vs leaves</h3>
          <div className="ins-card-sub">{t.netMembers === null ? 'not counted yet' : `net ${t.netMembers > 0 ? '+' : ''}${t.netMembers} members over the range`}</div>
          {chartsFor
            ? <DualLine a={series.joins} b={series.leaves} aName="joined" bName="left" label={`Joins and leaves per day, last ${data.range.days} days`} />
            : <div className="ins-empty">no join or leave counts yet.</div>}
        </div>

        <div className="ins-card">
          <h3>Mod actions</h3>
          <div className="ins-card-sub">{fmt(t.modActions)} logged in this range</div>
          {modAny ? (
            <>
              <BarChart data={series.modActions} label={`Mod actions per day, last ${data.range.days} days`} unit="actions" />
              <RankRows items={modByType} nameKey="type" label="Mod actions by type" />
            </>
          ) : <div className="ins-empty">no mod actions in this range. quiet is good.</div>}
        </div>
      </div>

      <div className="ins-card">
        <h3>Top commands</h3>
        <div className="ins-card-sub">how often each command ran here. no names attached.</div>
        {topCommands.length
          ? <RankRows items={topCommands} nameKey="name" label="Top commands" />
          : <div className="ins-empty">{chartsFor ? 'no commands used in this range.' : 'command counts have not started yet.'}</div>}
      </div>

      {notes.length > 0 && (
        <ul className="ins-notes" aria-label="About this data">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
      )}
    </div>
  )
}
