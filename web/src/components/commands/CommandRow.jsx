import { memo } from 'react'
import { Check, ChevronDown, Copy } from 'lucide-react'
import { Highlight } from './Highlight'
import { DEFAULT_PREFIX, primaryForm, usageLines } from './format'

export function CopyButton({ text, copied, onCopy, label, className = '' }) {
  const done = copied === text
  return (
    <button
      type="button"
      className={`cx-copy ${done ? 'is-done' : ''} ${className}`}
      onClick={() => onCopy(text)}
      aria-label={label || `Copy ${text}`}
      title={done ? 'Copied' : `Copy ${text}`}
    >
      {done ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </button>
  )
}

function Usage({ kind, text, copied, onCopy }) {
  return (
    <div className="cx-usage">
      <span className="cx-usage-kind">{kind}</span>
      <code className="cx-usage-code">{text}</code>
      <CopyButton text={text} copied={copied} onCopy={onCopy} />
    </div>
  )
}

function Panel({ cmd, copied, onCopy, id }) {
  const lines = usageLines(cmd, DEFAULT_PREFIX)
  const hasSubs = !!cmd.subcommands?.length
  return (
    <div className="cx-panel" id={id}>
      {lines.map((l, i) => (
        <div className="cx-variant" key={i}>
          {hasSubs && <p className="cx-variant-desc">{l.desc}</p>}
          <div className="cx-usage-box">
            {l.slash && <Usage kind="Slash" text={l.slash} copied={copied} onCopy={onCopy} />}
            <Usage kind="Prefix" text={l.prefix} copied={copied} onCopy={onCopy} />
          </div>
          {l.options.length > 0 && (
            <dl className="cx-opts">
              {l.options.map((o) => (
                <div key={o.name} className="cx-opt">
                  <dt><code>{o.name}</code><span className="cx-opt-type">{o.type}{o.required ? '' : ', optional'}</span></dt>
                  <dd>{o.desc}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ))}
      <div className="cx-meta">
        <span className="cx-meta-label">Aliases</span>
        {cmd.aliases.length
          ? cmd.aliases.map((a) => <code key={a} className="cx-alias">{DEFAULT_PREFIX}{a}</code>)
          : <span className="cx-meta-none">None</span>}
      </div>
      {!cmd.slash && <p className="cx-note">Prefix only: type it in chat, it does not appear in the slash menu.</p>}
    </div>
  )
}

export const CommandRow = memo(function CommandRow({ cmd, query, open, onToggle, copied, onCopy }) {
  const id = `cx-${cmd.name}`
  const sigil = cmd.slash ? '/' : DEFAULT_PREFIX
  const aliasHit = query && !cmd.name.includes(query) ? cmd.aliases.find((a) => a.includes(query)) : null
  return (
    <li className={`cx-row ${open ? 'is-open' : ''}`} id={`row-${cmd.name}`}>
      <div className="cx-head">
        <button type="button" className="cx-toggle" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => onToggle(cmd.name)}>
          <span className="cx-name">
            <span className="cx-sigil" aria-hidden="true">{sigil}</span>
            <Highlight text={cmd.name} query={query} />
          </span>
          <span className="cx-desc">
            <Highlight text={cmd.desc} query={query} />
            {aliasHit && <span className="cx-aliashit"> (alias <Highlight text={DEFAULT_PREFIX + aliasHit} query={query} />)</span>}
          </span>
          <span className={`cx-badge ${cmd.slash ? 'is-slash' : ''}`}>{cmd.slash ? 'Slash + prefix' : 'Prefix only'}</span>
          <ChevronDown className="cx-chev" size={16} aria-hidden="true" />
        </button>
        <CopyButton text={primaryForm(cmd)} copied={copied} onCopy={onCopy} />
      </div>
      {open && <Panel cmd={cmd} copied={copied} onCopy={onCopy} id={id} />}
    </li>
  )
})
