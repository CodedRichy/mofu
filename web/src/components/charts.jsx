import '../styles/insights.css'

// Inline-SVG chart primitives for Insights. No dependencies. Every chart is role="img" with a label and has a
// visually hidden table with the same numbers. A null value means "not counted": it is drawn as a gap, never as 0.

export const fmt = (n) => (n === null || n === undefined ? 'n/a' : Number(n).toLocaleString())

export function shortDate(d) {
  if (!d) return ''
  const [, m, day] = d.split('-')
  return `${Number(m)}/${Number(day)}`
}

// Percent change vs the previous period. Returns null when it cannot be stated honestly.
export function deltaText(cur, prev) {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return null
  if (prev === 0) return cur === 0 ? 'same as before' : 'new vs 0 before'
  const pct = Math.round(((cur - prev) / prev) * 100)
  if (pct === 0) return 'same as before'
  return `${pct > 0 ? '+' : ''}${pct}% vs before`
}

export function Kpi({ label, value, cur, prev, sub }) {
  const d = deltaText(cur === undefined ? value : cur, prev)
  const na = value === null || value === undefined
  return (
    <div className="ins-kpi">
      <div className="ins-kpi-label">{label}</div>
      <div className={`ins-kpi-value${na ? ' is-na' : ''}`}>{na ? 'n/a' : fmt(value)}</div>
      <div className="ins-kpi-sub">{d || (na ? 'not counted yet' : sub) || ''}</div>
    </div>
  )
}

export function RangeToggle({ days, onChange }) {
  return (
    <div className="ins-toggle" role="radiogroup" aria-label="Time range">
      {[7, 30].map((d) => (
        <button key={d} type="button" role="radio" aria-checked={days === d} onClick={() => onChange(d)}>{d} days</button>
      ))}
    </div>
  )
}

function DataTable({ caption, columns, dates, rows }) {
  return (
    <table className="ins-sr">
      <caption>{caption}</caption>
      <thead><tr><th>Day</th>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>
        {dates.map((d, i) => (
          <tr key={d}><td>{d}</td>{rows.map((r, j) => <td key={j}>{r[i] === null ? 'not counted' : r[i]}</td>)}</tr>
        ))}
      </tbody>
    </table>
  )
}

const W = 600
const H = 150
const PAD = 6

// Bars: one per day. null days are drawn as a short hatch tick so a gap reads as "not counted".
export function BarChart({ data, label, unit = 'messages' }) {
  const vals = data.map((p) => p.count)
  const max = Math.max(1, ...vals.map((v) => v || 0))
  const n = data.length
  const slot = (W - PAD * 2) / n
  const bw = Math.max(2, slot * (n > 14 ? 0.7 : 0.62))
  return (
    <div>
      <svg className="ins-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${vals.map((v, i) => `${shortDate(data[i].date)} ${v === null ? 'not counted' : v}`).join(', ')}`}>
        {[0.5, 1].map((f) => <line key={f} x1={PAD} x2={W - PAD} y1={H - f * (H - 8)} y2={H - f * (H - 8)} stroke="var(--border-subtle)" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
        {data.map((p, i) => {
          const x = PAD + i * slot + (slot - bw) / 2
          if (p.count === null) return <rect key={p.date} x={x} y={H - 3} width={bw} height="2" fill="var(--fg-4)" opacity="0.5"><title>{`${p.date}: not counted`}</title></rect>
          const h = p.count === 0 ? 1.5 : Math.max(2, (p.count / max) * (H - 8))
          return <rect key={p.date} x={x} y={H - h} width={bw} height={h} rx="2" fill={p.count ? 'var(--fg-1)' : 'var(--fg-4)'} opacity={p.count ? 0.92 : 0.6}><title>{`${p.date}: ${p.count} ${unit}`}</title></rect>
        })}
      </svg>
      <div className="ins-axis" aria-hidden="true"><span>{shortDate(data[0]?.date)}</span><span>peak {fmt(max === 1 && !vals.some(Boolean) ? 0 : max)}</span><span>{shortDate(data[n - 1]?.date)}</span></div>
      <DataTable caption={label} columns={[unit]} dates={data.map((p) => p.date)} rows={[vals]} />
    </div>
  )
}

// Two lines on one scale: solid and dashed, so they differ by pattern and not only by tone.
export function DualLine({ a, b, aName, bName, label }) {
  const all = [...a, ...b].map((p) => p.count).filter((v) => v !== null)
  const max = Math.max(1, ...all)
  const n = a.length
  const x = (i) => PAD + (n === 1 ? 0 : (i * (W - PAD * 2)) / (n - 1))
  const y = (v) => H - 6 - (v / max) * (H - 18)
  const path = (s) => {
    let d = ''
    let pen = false
    s.forEach((p, i) => {
      if (p.count === null) { pen = false; return }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.count).toFixed(1)} `
      pen = true
    })
    return d.trim()
  }
  const sum = (s) => s.reduce((t, p) => t + (p.count || 0), 0)
  return (
    <div>
      <svg className="ins-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${aName} ${sum(a)} total, ${bName} ${sum(b)} total`}>
        {[0.5, 1].map((f) => <line key={f} x1={PAD} x2={W - PAD} y1={H - 6 - f * (H - 18)} y2={H - 6 - f * (H - 18)} stroke="var(--border-subtle)" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
        <path d={path(b)} fill="none" stroke="var(--fg-3)" strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <path d={path(a)} fill="none" stroke="var(--fg-1)" strokeWidth="2.25" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {a.map((p, i) => p.count === null ? null : <circle key={p.date} cx={x(i)} cy={y(p.count)} r={n > 14 ? 0 : 2.6} fill="var(--fg-1)"><title>{`${p.date}: ${aName} ${p.count}`}</title></circle>)}
      </svg>
      <div className="ins-axis" aria-hidden="true"><span>{shortDate(a[0]?.date)}</span><span>peak {fmt(max)}</span><span>{shortDate(a[n - 1]?.date)}</span></div>
      <div className="ins-legend" aria-hidden="true"><span><i />{aName}</span><span><i className="dash" />{bName}</span></div>
      <DataTable caption={label} columns={[aName, bName]} dates={a.map((p) => p.date)} rows={[a.map((p) => p.count), b.map((p) => p.count)]} />
    </div>
  )
}

export function Spark({ values, label }) {
  const real = values.filter((v) => v !== null)
  if (!real.length) return <div className="ins-spark" aria-hidden="true" />
  const max = Math.max(1, ...real)
  const n = values.length
  const w = 200
  const h = 36
  const x = (i) => (n === 1 ? 0 : (i * (w - 2)) / (n - 1)) + 1
  const y = (v) => h - 3 - (v / max) * (h - 8)
  let d = ''
  let pen = false
  values.forEach((v, i) => {
    if (v === null) { pen = false; return }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `
    pen = true
  })
  const first = values.findIndex((v) => v !== null)
  const area = `${d} L${x(n - 1).toFixed(1)} ${h} L${x(first).toFixed(1)} ${h} Z`
  return (
    <svg className="ins-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`${label}: ${values.map((v) => (v === null ? 'not counted' : v)).join(', ')}`}>
      <path d={area} fill="var(--fg-1)" opacity="0.1" />
      <path d={d.trim()} fill="none" stroke="var(--fg-2)" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function RankRows({ items, nameKey, label }) {
  const max = Math.max(1, ...items.map((i) => i.count))
  return (
    <ul className="ins-rows" aria-label={label}>
      {items.map((it) => (
        <li key={it[nameKey]} className="ins-row">
          <span className="ins-row-name" title={it[nameKey]}>{it[nameKey]}</span>
          <span className="ins-row-bar" aria-hidden="true"><span style={{ width: `${Math.max(3, (it.count / max) * 100)}%` }} /></span>
          <span className="ins-row-n">{fmt(it.count)}</span>
        </li>
      ))}
    </ul>
  )
}
