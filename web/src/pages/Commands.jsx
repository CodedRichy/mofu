import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, X } from 'lucide-react'
import { Layout } from '../components/Layout'
import { CommandRow } from '../components/commands/CommandRow'
import { useCopy } from '../components/commands/useCopy'
import { CATEGORY_META, DEFAULT_PREFIX, catLabel, normaliseQuery, orderCategories, score } from '../components/commands/format'
import '../components/commands/commands.css'

// The list is generated from src/commands by web/scripts/gen-commands.mjs and loaded as its own chunk,
// so the ~50KB of command data never weighs on the landing page.
let cache = null
const loadCommands = () => (cache ||= import('../components/commands/commands.json').then((m) => m.default))

const TYPES = [
  { key: 'all', label: 'All' },
  { key: 'slash', label: 'Slash' },
  { key: 'prefix', label: 'Prefix only' },
]

export function Commands() {
  const [params, setParams] = useSearchParams()
  const [all, setAll] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [input, setInput] = useState(() => params.get('q') || '')
  const [open, setOpen] = useState(() => new Set())
  const searchRef = useRef(null)
  const initialHash = useRef(typeof window === 'undefined' ? '' : window.location.hash)
  const { copy, copied, message } = useCopy()

  const cat = params.get('cat') || 'all'
  const type = TYPES.some((t) => t.key === params.get('type')) ? params.get('type') : 'all'
  const query = normaliseQuery(useDeferredValue(input))

  useEffect(() => {
    let live = true
    loadCommands().then((d) => live && setAll(d)).catch(() => live && setLoadError(true))
    return () => { live = false }
  }, [])

  // URL is the source of truth for cat/type and mirrors q (replace, so typing does not flood history)
  const setParam = useCallback((key, value, fallback) => {
    const want = !value || value === fallback ? null : value
    // skip no-op navigations: they would also drop the #command hash before it is read
    if (new URLSearchParams(window.location.search).get(key) === want) return
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (!value || value === fallback) next.delete(key)
      else next.set(key, value)
      return next
    }, { replace: true })
  }, [setParams])

  useEffect(() => { setParam('q', input.trim(), '') }, [input, setParam])

  // back/forward or a pasted link: pull q from the URL if it changed under us
  useEffect(() => {
    const q = params.get('q') || ''
    if (q !== input.trim()) setInput(q)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  // "/" focuses search from anywhere on the page; Escape clears, then leaves
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      e.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // /commands#ban opens that row and scrolls to it, so a single command can be linked
  useEffect(() => {
    if (!all) return
    const name = decodeURIComponent(initialHash.current.slice(1)).toLowerCase()
    if (!name || !all.some((c) => c.name === name)) return
    setOpen((prev) => new Set(prev).add(name))
    requestAnimationFrame(() => document.getElementById(`row-${name}`)?.scrollIntoView({ block: 'start' }))
  }, [all])

  const categories = useMemo(() => (all ? orderCategories(all.map((c) => c.category)) : []), [all])
  const totals = useMemo(() => {
    if (!all) return null
    const slash = all.filter((c) => c.slash).length
    return { all: all.length, slash, prefix: all.length - slash }
  }, [all])

  // everything that matches the query and type, before the category filter (drives the rail counts)
  const matched = useMemo(() => {
    if (!all) return []
    return all
      .filter((c) => type === 'all' || (type === 'slash' ? c.slash : !c.slash))
      .map((c) => ({ c, s: score(c, query) }))
      .filter((x) => x.s > 0)
  }, [all, query, type])

  const counts = useMemo(() => {
    const m = { all: matched.length }
    for (const { c } of matched) m[c.category] = (m[c.category] || 0) + 1
    return m
  }, [matched])

  const activeCat = cat !== 'all' && categories.length && !categories.includes(cat) ? 'all' : cat
  const visible = useMemo(() => {
    const list = matched.filter((x) => activeCat === 'all' || x.c.category === activeCat)
    if (query) list.sort((a, b) => b.s - a.s || a.c.name.localeCompare(b.c.name))
    return list.map((x) => x.c)
  }, [matched, activeCat, query])

  // no query: group by category in rail order. With a query: one ranked list, best match first.
  const groups = useMemo(() => {
    if (query) return visible.length ? [{ key: 'results', items: visible }] : []
    const by = {}
    for (const c of visible) (by[c.category] ||= []).push(c)
    return categories.filter((k) => by[k]).map((k) => ({ key: k, items: by[k].sort((a, b) => a.name.localeCompare(b.name)) }))
  }, [visible, query, categories])

  const toggle = useCallback((name) => {
    setOpen((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }, [])

  const pickCat = (k) => setParam('cat', k, 'all')
  const clearAll = () => { setInput(''); setParams(new URLSearchParams(), { replace: true }); searchRef.current?.focus() }

  return (
    <Layout>
      <div className="cx">
        <header className="cx-hero">
          <div className="cx-dots" aria-hidden="true" />
          <p className="cx-eyebrow">Command reference</p>
          <h1 className="cx-h1">
            {totals ? <>{totals.all} commands.</> : 'Commands.'}
            <span>Find one, copy it, paste it.</span>
          </h1>
          <p className="cx-lede">
            {totals
              ? <>{totals.slash} work as slash and prefix commands, {totals.prefix} are prefix only. The default prefix is <code>{DEFAULT_PREFIX}</code> and each server can change it with <code>/prefix</code>.</>
              : <>Every command works with the <code>{DEFAULT_PREFIX}</code> prefix; the most used ones are slash commands too.</>}
          </p>
        </header>

        <div className="cx-tools">
          <label className="cx-search">
            <Search size={16} aria-hidden="true" className="cx-search-icon" />
            <span className="cx-sr">Search commands</span>
            <input
              ref={searchRef}
              type="search"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return
                if (input) { e.preventDefault(); setInput('') } else e.currentTarget.blur()
              }}
              placeholder="Search by name, alias or what it does"
              autoComplete="off"
              spellCheck={false}
              aria-describedby="cx-count"
            />
            {input
              ? <button type="button" className="cx-clear" onClick={() => { setInput(''); searchRef.current?.focus() }} aria-label="Clear search"><X size={14} aria-hidden="true" /></button>
              : <kbd className="cx-kbd" aria-hidden="true">/</kbd>}
          </label>
          <div className="cx-types" role="group" aria-label="Command type">
            {TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                className="cx-chip"
                aria-pressed={type === t.key}
                onClick={() => setParam('type', t.key, 'all')}
              >
                {t.label}
                {totals && <span className="cx-chip-n">{totals[t.key]}</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="cx-body">
          <nav className="cx-rail" aria-label="Categories">
            <p className="cx-rail-title">Categories</p>
            <ul>
              {['all', ...categories].map((k) => (
                <li key={k}>
                  <button
                    type="button"
                    className="cx-rail-btn"
                    aria-pressed={activeCat === k}
                    onClick={() => pickCat(k)}
                    disabled={!all}
                  >
                    <span>{k === 'all' ? 'All' : catLabel(k)}</span>
                    <span className="cx-rail-n">{all ? counts[k] || 0 : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <section className="cx-list" aria-label="Commands">
            <p id="cx-count" className="cx-count" role="status" aria-live="polite">
              {!all ? (loadError ? '' : 'Loading commands...')
                : `${visible.length} ${visible.length === 1 ? 'command' : 'commands'}${query ? ` matching "${query}"` : ''}${activeCat !== 'all' ? ` in ${catLabel(activeCat)}` : ''}`}
            </p>

            {loadError && (
              <div className="cx-empty">
                <p className="cx-empty-title">The command list did not load.</p>
                <p>Check your connection and reload the page.</p>
              </div>
            )}

            {all && visible.length === 0 && (
              <div className="cx-empty">
                <p className="cx-empty-title">Nothing matches {query ? <>"<span className="cx-empty-q">{query}</span>"</> : 'these filters'}.</p>
                <p>Try a shorter word, a single letter alias like <code>b</code> for ban, or what the command does, like "queue".</p>
                <div className="cx-empty-actions">
                  {activeCat !== 'all' && counts.all > 0 && (
                    <button type="button" className="cx-pill" onClick={() => pickCat('all')}>Search all categories ({counts.all})</button>
                  )}
                  <button type="button" className="cx-pill cx-pill--ghost" onClick={clearAll}>Clear filters</button>
                </div>
              </div>
            )}

            {groups.map((g) => (
              <div key={g.key} className="cx-group">
                {!query && (
                  <div className="cx-group-head">
                    <h2>{catLabel(g.key)}</h2>
                    {CATEGORY_META[g.key]?.blurb && <p>{CATEGORY_META[g.key].blurb}</p>}
                  </div>
                )}
                <ul className="cx-rows">
                  {g.items.map((c) => (
                    <CommandRow key={c.name} cmd={c} query={query} open={open.has(c.name)} onToggle={toggle} copied={copied} onCopy={copy} />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </div>

        <p className="cx-sr" role="status" aria-live="polite">{message}</p>
      </div>
    </Layout>
  )
}
