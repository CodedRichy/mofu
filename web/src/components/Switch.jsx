export function Switch({ checked, onChange, label, disabled = false, style }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2-5)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1, ...style }}>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={typeof label === 'string' ? label : undefined}
        disabled={disabled}
        type="button"
        onClick={() => !disabled && onChange(!checked)}
        style={{
          width: 36, height: 20, borderRadius: 'var(--radius-full)', padding: 2,
          background: checked ? 'var(--accent)' : 'var(--surface-3)',
          border: `1px solid ${checked ? 'var(--accent)' : 'var(--border-default)'}`,
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'background 120ms var(--ease-default), border-color 120ms var(--ease-default)',
          display: 'flex', alignItems: 'center',
        }}
      >
        <div style={{
          width: 14, height: 14, borderRadius: '50%',
          background: checked ? 'var(--accent-fg)' : 'var(--fg-2)',
          transform: checked ? 'translateX(16px)' : 'translateX(0)',
          transition: 'transform 160ms var(--ease-spring)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }} />
      </button>
      {label && <span style={{ fontSize: 13, color: 'var(--fg-2)', fontFamily: 'var(--font-body)' }}>{label}</span>}
    </label>
  )
}
