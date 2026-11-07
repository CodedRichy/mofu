import { useState } from 'react'

const sizes = {
  sm: { height: 28, padding: '0 10px', fontSize: 12, gap: 5, radius: 'var(--radius-sm)' },
  md: { height: 34, padding: '0 14px', fontSize: 13.5, gap: 6, radius: 'var(--radius-md)' },
  lg: { height: 42, padding: '0 18px', fontSize: 15, gap: 7, radius: 'var(--radius-lg)' },
}

export function Button({
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  leftIcon,
  rightIcon,
  children,
  onClick,
  style,
  ...rest
}) {
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)
  const s = sizes[size]

  const variants = {
    primary: {
      background: hovered ? 'var(--accent-hover)' : 'var(--accent)',
      color: 'var(--accent-fg)',
      border: '1px solid rgba(0,0,0,0.18)',
      boxShadow: hovered ? 'var(--shadow-accent)' : '0 1px 3px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.12)',
    },
    secondary: {
      background: hovered ? 'var(--surface-3)' : 'var(--surface-2)',
      color: 'var(--fg-1)',
      border: '1px solid var(--border-default)',
      boxShadow: 'var(--shadow-xs)',
    },
    ghost: {
      background: hovered ? 'var(--surface-hover)' : 'transparent',
      color: hovered ? 'var(--fg-1)' : 'var(--fg-2)',
      border: '1px solid transparent',
      boxShadow: 'none',
    },
    destructive: {
      background: hovered ? 'var(--error-subtle)' : 'transparent',
      color: 'var(--error)',
      border: `1px solid ${hovered ? 'var(--error-border)' : 'transparent'}`,
      boxShadow: 'none',
    },
  }

  const v = variants[variant] || variants.primary

  return (
    <button
      disabled={disabled}
      onClick={!disabled && !loading ? onClick : undefined}
      onMouseEnter={() => !disabled && setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false) }}
      onMouseDown={() => !disabled && setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'var(--font-body)',
        fontWeight: 500,
        letterSpacing: '-0.01em',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        userSelect: 'none',
        transition: 'background 100ms var(--ease-default), box-shadow 120ms var(--ease-default), transform 80ms',
        opacity: disabled ? 0.4 : 1,
        transform: pressed && !disabled ? 'scale(0.97)' : 'scale(1)',
        height: s.height,
        padding: s.padding,
        fontSize: s.fontSize,
        gap: s.gap,
        borderRadius: s.radius,
        ...v,
        ...style,
      }}
      {...rest}
    >
      {loading ? (
        <span style={{
          width: 14, height: 14, borderRadius: '50%',
          border: '1.5px solid currentColor', borderTopColor: 'transparent',
          display: 'inline-block', animation: 'spin 0.65s linear infinite',
        }} />
      ) : leftIcon ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', opacity: 0.8 }}>{leftIcon}</span>
      ) : null}
      {children}
      {!loading && rightIcon && (
        <span style={{ display: 'inline-flex', alignItems: 'center', opacity: 0.65 }}>{rightIcon}</span>
      )}
    </button>
  )
}
