import { useState } from 'react'

export function Tabs({ items, activeId, onChange, variant = 'default', style }) {
  const [hovered, setHovered] = useState(null)

  const getItemStyle = (item) => {
    const active = item.id === activeId
    const isHovered = hovered === item.id

    if (variant === 'pills') {
      return {
        height: 28, padding: '0 12px', borderRadius: 'var(--radius-md)',
        background: active ? 'var(--surface-2)' : isHovered ? 'var(--surface-hover)' : 'transparent',
        border: active ? '1px solid var(--border-default)' : '1px solid transparent',
        color: active ? 'var(--fg-1)' : 'var(--fg-3)',
        fontWeight: active ? 500 : 400,
      }
    }

    if (variant === 'underline') {
      return {
        height: 36, padding: '0 2px',
        background: 'transparent', border: 'none',
        color: active ? 'var(--fg-1)' : 'var(--fg-3)',
        fontWeight: active ? 500 : 400,
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        borderRadius: 0,
      }
    }

    return {
      height: 30, padding: '0 10px', borderRadius: 'var(--radius-md)',
      background: active ? 'var(--accent-subtle)' : isHovered ? 'var(--surface-hover)' : 'transparent',
      border: '1px solid transparent',
      color: active ? 'var(--accent)' : 'var(--fg-2)',
      fontWeight: active ? 500 : 400,
    }
  }

  return (
    <div role="tablist" style={{ display: 'flex', gap: 2, alignItems: 'center', overflowX: 'auto', maxWidth: '100%', ...style }}>
      {items.map(item => (
        <button
          key={item.id}
          role="tab"
          aria-selected={item.id === activeId}
          onClick={() => onChange(item.id)}
          onMouseEnter={() => setHovered(item.id)}
          onMouseLeave={() => setHovered(null)}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontFamily: 'var(--font-body)', letterSpacing: '-0.01em',
            cursor: 'pointer', transition: 'all 80ms var(--ease-default)',
            whiteSpace: 'nowrap',
            ...getItemStyle(item),
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
