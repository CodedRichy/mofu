import { useState } from 'react'

const variantStyles = {
  default: {
    background: 'var(--surface-1)',
    border: '1px solid var(--border-default)',
    boxShadow: 'var(--shadow-sm)',
  },
  glass: {
    background: 'var(--glass-bg)',
    border: '1px solid var(--glass-border)',
    boxShadow: 'var(--glass-shadow)',
    backdropFilter: 'blur(var(--glass-blur))',
    WebkitBackdropFilter: 'blur(var(--glass-blur))',
  },
  outline: {
    background: 'transparent',
    border: '1px solid var(--border-default)',
    boxShadow: 'none',
  },
  elevated: {
    background: 'var(--surface-2)',
    border: '1px solid var(--border-subtle)',
    boxShadow: 'var(--shadow-md)',
  },
}

const paddings = { none: 0, sm: 'var(--space-3)', md: 'var(--space-5)', lg: 'var(--space-6)' }

export function Card({ variant = 'default', padding = 'md', children, onClick, style, ...rest }) {
  const [hovered, setHovered] = useState(false)
  const interactive = !!onClick
  const v = variantStyles[variant] || variantStyles.default

  return (
    <div
      onClick={onClick}
      {...(interactive ? {
        role: 'button',
        tabIndex: 0,
        onKeyDown: e => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(e) }
        },
      } : {})}
      onMouseEnter={() => interactive && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderRadius: 'var(--radius-lg)',
        padding: paddings[padding],
        cursor: interactive ? 'pointer' : undefined,
        transition: interactive ? 'background 120ms var(--ease-default)' : undefined,
        ...v,
        background: interactive && hovered ? 'var(--surface-2)' : v.background,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  )
}
