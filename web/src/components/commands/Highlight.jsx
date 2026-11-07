// Wraps every case-insensitive occurrence of `query` in <mark>. Plain text in, React nodes out (no innerHTML).
export function Highlight({ text, query }) {
  if (!query || !text) return text || null
  const lower = text.toLowerCase()
  const out = []
  let i = 0
  let hit = lower.indexOf(query)
  while (hit !== -1) {
    if (hit > i) out.push(text.slice(i, hit))
    out.push(<mark key={hit} className="cx-mark">{text.slice(hit, hit + query.length)}</mark>)
    i = hit + query.length
    hit = lower.indexOf(query, i)
  }
  if (i < text.length) out.push(text.slice(i))
  return out
}
