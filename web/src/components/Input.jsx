import { useState, useId } from 'react'

const sizes = {
  sm: { height: 'var(--input-height-sm)', fontSize: 12.5, px: 'var(--space-2-5)' },
  md: { height: 'var(--input-height-md)', fontSize: 13.5, px: 'var(--space-3)' },
  lg: { height: 'var(--input-height-lg)', fontSize: 15, px: 'var(--space-4)' },
}

export function Input({
  label,
  hint,
  error,
  size = 'md',
  leadingIcon,
  trailingIcon,
  disabled = false,
  style,
  ...rest
}) {
  const [focused, setFocused] = useState(false)
  const autoId = useId()
  const id = rest.id || autoId
  const hintId = `${id}-hint`
  const s = sizes[size]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1-5)', width: '100%', ...style }}>
      {label && (
        <label htmlFor={id} style={{
          fontSize: 'var(--text-xs)', fontWeight: 500,
          color: 'var(--fg-2)', letterSpacing: '0.01em', fontFamily: 'var(--font-body)',
        }}>
          {label}
        </label>
      )}
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
        width: '100%', height: s.height, padding: `0 ${s.px}`,
        background: 'var(--surface-1)',
        border: `1px solid ${error ? 'var(--error)' : focused ? 'var(--border-focus)' : 'var(--border-default)'}`,
        borderRadius: 'var(--radius-md)',
        boxShadow: error ? '0 0 0 2px var(--error-subtle)' : focused ? '0 0 0 2px rgba(255, 255, 255, 0.09)' : 'none',
        transition: 'border-color 100ms var(--ease-default), box-shadow 100ms var(--ease-default)',
        opacity: disabled ? 0.45 : 1,
      }}>
        {leadingIcon && <span style={{ display: 'inline-flex', color: 'var(--fg-3)', flexShrink: 0 }}>{leadingIcon}</span>}
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={(hint || error) ? hintId : undefined}
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1, background: 'none', border: 'none', outline: 'none',
            color: 'var(--fg-1)', fontFamily: 'var(--font-body)', fontSize: s.fontSize,
            letterSpacing: 'var(--tracking-base)', minWidth: 0,
          }}
          {...rest}
        />
        {trailingIcon && <span style={{ display: 'inline-flex', color: 'var(--fg-3)', flexShrink: 0 }}>{trailingIcon}</span>}
      </div>
      {(hint || error) && (
        <span id={hintId} style={{ fontSize: 'var(--text-xs)', color: error ? 'var(--error)' : 'var(--fg-3)', fontFamily: 'var(--font-body)' }}>
          {error || hint}
        </span>
      )}
    </div>
  )
}
