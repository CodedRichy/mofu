import { Fragment } from 'react'

// Discord message primitives for the landing mocks. They render what discord.js embeds look like in the client:
// a 4px colour rail, author line, description, inline fields, thumbnail top-right, footer with icon + timestamp.
// Rail colours are the bot's own (src/utils/constants.js), converted to OKLCH.
export const RAIL = {
  primary: 'oklch(1 0 0)',            // 0xffffff
  success: 'oklch(0.723 0.192 149.6)', // 0x22c55e
  warning: 'oklch(0.837 0.164 84.4)',  // 0xfbbf24
  error: 'oklch(0.711 0.166 22.2)',    // 0xf87171
  muted: 'oklch(0.551 0.023 264.4)',   // 0x6b7280
}

export const clock = () => new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

// Discord-flavoured inline markdown: **bold**, `code`, [link](x) inside bold, and highlighted @mentions.
export function Md({ text, mentions = [] }) {
  const parts = String(text).split(/(\*\*\[[^\]]+\]\([^)]*\)\*\*|\*\*[^*]+\*\*|`[^`]+`|@[\w.-]+)/g)
  return parts.map((p, i) => {
    let m
    if ((m = /^\*\*\[([^\]]+)\]\([^)]*\)\*\*$/.exec(p))) return <b key={i} className="dc-link">{m[1]}</b>
    if (/^\*\*.+\*\*$/.test(p)) return <b key={i}>{p.slice(2, -2)}</b>
    if (/^`.+`$/.test(p)) return <code key={i} className="dc-code">{p.slice(1, -1)}</code>
    if (/^@/.test(p) && mentions.includes(p.slice(1).toLowerCase())) return <span key={i} className="dc-mention">{p}</span>
    return <Fragment key={i}>{p}</Fragment>
  })
}

export function BotIcon({ size = 20 }) {
  return <img className="dc-icon" src="/logo.jpg" alt="" width={size} height={size} />
}

// a neutral avatar for mock members: grey disc with an initial (no faces, no names)
export function MemberIcon({ name = '?', size = 20 }) {
  return <span className="dc-micon" style={{ width: size, height: size, fontSize: size * 0.48 }} aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
}

export function Embed({ color = 'primary', author, authorIcon, thumb, fields, footer = 'sonder', footerIcon = true, at, children }) {
  return (
    <div className="dc-embed" style={{ '--rail': RAIL[color] || color }}>
      <div className="dc-ebody">
        {author && <div className="dc-author">{authorIcon}{author}</div>}
        {children && <div className="dc-desc">{children}</div>}
        {fields && (
          <div className="dc-fields">
            {fields.map((f) => (
              <div key={f.name} className={`dc-field ${f.inline ? 'is-inline' : ''}`}>
                <div className="dc-fname">{f.name}</div>
                <div className="dc-fval">{f.value}</div>
              </div>
            ))}
          </div>
        )}
        {footer && <div className="dc-footer">{footerIcon && <BotIcon size={20} />}<span>{footer}{at ? <> {'•'} Today at {at}</> : null}</span></div>}
      </div>
      {thumb && <div className="dc-thumb">{thumb}</div>}
    </div>
  )
}

// Discord button styles: secondary (grey), success (green), danger (red), primary (blurple in Discord;
// warn proposals use it). Labels only, like the bot's buttons.
export function DButton({ kind = 'secondary', children, ...rest }) {
  return <button type="button" className={`dc-btn dc-btn--${kind}`} {...rest}>{children}</button>
}

// Discord's relative timestamp (<t:x:R>) wording
export function relative(ms) {
  const s = Math.round(ms / 1000)
  if (s <= 0) return 'now'
  if (s < 45) return `in ${s} seconds`
  if (s < 90) return 'in a minute'
  return `in ${Math.round(s / 60)} minutes`
}
