const sizeMap = { xs: 20, sm: 24, md: 32, lg: 40, xl: 48 }

export function Avatar({ src, initials, size = 'md', status, alt = '', style, ...rest }) {
  const px = sizeMap[size] || sizeMap.md
  const fontSize = px * 0.38

  return (
    <div style={{ position: 'relative', display: 'inline-flex', flexShrink: 0, ...style }} {...rest}>
      <div style={{
        width: px, height: px, borderRadius: '50%',
        background: src ? 'var(--surface-2)' : 'var(--accent-subtle)',
        border: '1px solid var(--border-default)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
      }}>
        {src ? (
          <img src={src} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize, fontWeight: 600, color: 'var(--accent)', fontFamily: 'var(--font-body)' }}>
            {initials}
          </span>
        )}
      </div>
      {status && (
        <div style={{
          position: 'absolute', bottom: 0, right: 0,
          width: px * 0.3, height: px * 0.3, borderRadius: '50%',
          background: status === 'online' ? 'var(--success)' : status === 'idle' ? 'var(--warning)' : 'var(--fg-4)',
          border: '2px solid var(--bg)',
        }} />
      )}
    </div>
  )
}
