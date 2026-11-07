const variants = {
  default: { background: 'var(--surface-2)', color: 'var(--fg-2)', border: '1px solid var(--border-default)' },
  accent: { background: 'var(--accent-subtle)', color: 'var(--accent)', border: '1px solid var(--border-accent)' },
  success: { background: 'var(--success-subtle)', color: 'var(--success)', border: '1px solid var(--success-border)' },
  warning: { background: 'var(--warning-subtle)', color: 'var(--warning)', border: '1px solid var(--warning-border)' },
  error: { background: 'var(--error-subtle)', color: 'var(--error)', border: '1px solid var(--error-border)' },
  outline: { background: 'transparent', color: 'var(--fg-2)', border: '1px solid var(--border-default)' },
}

export function Badge({ variant = 'default', children, style, ...rest }) {
  const v = variants[variant] || variants.default

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 20,
        padding: '0 7px',
        fontSize: 11,
        fontWeight: 500,
        fontFamily: 'var(--font-body)',
        letterSpacing: '0.01em',
        borderRadius: 'var(--radius-full)',
        whiteSpace: 'nowrap',
        ...v,
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  )
}
