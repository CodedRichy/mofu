import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { LogIn, LogOut, ChevronRight } from 'lucide-react'
import { useToken, clearToken, loginUrl as buildLoginUrl } from '../lib/auth'
import { api } from '../lib/api'

const NOISE_SVG = `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.025'/%3E%3C/svg%3E")`

const NAV_LINKS = [
  { path: '/commands', label: 'Commands' },
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/status', label: 'Status' },
]

function NavLink({ to, label, active, entranceDelay = 0 }) {
  const [h, setH] = useState(false)
  return (
    <Link
      to={to}
      className="nav-link"
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        position: 'relative',
        zIndex: 1,
        fontSize: 'var(--text-base)',
        fontWeight: active ? 'var(--weight-medium)' : 'var(--weight-normal)',
        color: active ? 'var(--fg-1)' : h ? 'var(--fg-1)' : 'var(--fg-3)',
        textDecoration: 'none',
        padding: '8px 16px',
        borderRadius: 'var(--radius-md)',
        background: !active && h ? 'rgba(255, 255, 255, 0.04)' : 'transparent',
        transition: 'color 180ms var(--ease-spring), background 180ms var(--ease-spring)',
        letterSpacing: 'var(--tracking-base)',
        animation: `fade-up 450ms var(--ease-default) ${entranceDelay}ms both`,
      }}
    >
      {label}
    </Link>
  )
}

function LogoMark() {
  const [h, setH] = useState(false)
  return (
    <Link
      to="/"
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2-5)',
        textDecoration: 'none',
        transition: 'transform 220ms var(--ease-spring)',
        transform: h ? 'scale(1.04)' : 'scale(1)',
        animation: 'fade-up 450ms var(--ease-default) 0ms both',
      }}
    >
      <img src="/logo.jpg" alt="Sonder" style={{
        width: 36, height: 36,
        borderRadius: 'var(--radius-lg)',
        objectFit: 'cover',
        boxShadow: h
          ? '0 0 20px rgba(255, 255, 255, 0.2), 0 0 0 1px rgba(255, 255, 255, 0.13)'
          : '0 0 0 1px rgba(255, 255, 255, 0.06)',
        transition: 'box-shadow 280ms var(--ease-default)',
      }} />
      <span className="nav-word" style={{
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--text-lg)',
        fontWeight: 'var(--weight-bold)',
        color: 'var(--fg-1)',
        letterSpacing: 'var(--tracking-tight)',
      }}>sonder</span>
    </Link>
  )
}

export function Layout({ children, bare = false }) {
  const location = useLocation()
  const navigate = useNavigate()
  const token = useToken()
  const [user, setUser] = useState(null)
  const [scrolled, setScrolled] = useState(false)
  const [loginHover, setLoginHover] = useState(false)

  const navRef = useRef(null)
  const linksRef = useRef(null)
  const linkRefs = useRef([])
  const spotlightRef = useRef(null)
  const [pill, setPill] = useState({ left: 0, width: 0, opacity: 0 })

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const compute = () => {
      const activeIdx = NAV_LINKS.findIndex(l => location.pathname.startsWith(l.path))
      if (activeIdx >= 0 && linkRefs.current[activeIdx] && linksRef.current) {
        const lr = linkRefs.current[activeIdx].getBoundingClientRect()
        const cr = linksRef.current.getBoundingClientRect()
        setPill({ left: lr.left - cr.left, width: lr.width, opacity: 1 })
      } else {
        setPill(p => ({ ...p, opacity: 0 }))
      }
    }
    requestAnimationFrame(compute)
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [location.pathname])

  const handleMouseMove = useCallback((e) => {
    if (spotlightRef.current && navRef.current) {
      const rect = navRef.current.getBoundingClientRect()
      spotlightRef.current.style.left = `${e.clientX - rect.left - 120}px`
      spotlightRef.current.style.opacity = '1'
    }
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (spotlightRef.current) {
      spotlightRef.current.style.opacity = '0'
    }
  }, [])

  useEffect(() => {
    if (!token) { setUser(null); return }
    let cancelled = false
    // api() clears the token itself on a 401; any other failure (5xx, offline) keeps the session.
    api('/user', token, { noRedirect: true }).then(res => {
      if (!cancelled && res.ok) setUser(res.data)
    })
    return () => { cancelled = true }
  }, [token])

  const loginUrl = buildLoginUrl()

  const logout = () => {
    clearToken()
    setUser(null)
    navigate('/')
  }

  if (bare) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', position: 'relative' }}>
        <div style={{ position: 'fixed', inset: 0, backgroundImage: NOISE_SVG, backgroundRepeat: 'repeat', pointerEvents: 'none', zIndex: 0, opacity: 0.5 }} />
        <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', position: 'relative' }}>
      <div style={{ position: 'fixed', inset: 0, backgroundImage: NOISE_SVG, backgroundRepeat: 'repeat', pointerEvents: 'none', zIndex: 0, opacity: 0.5 }} />
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 300, background: 'var(--gradient-bg-top)', pointerEvents: 'none', zIndex: 0 }} />

      {/* Navbar */}
      <nav
        ref={navRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{
          position: 'sticky', top: 0, zIndex: 'var(--z-sticky)',
          height: 'var(--topbar-height)',
          background: scrolled ? 'var(--glass-bg)' : 'transparent',
          backdropFilter: scrolled ? 'blur(var(--glass-blur))' : 'none',
          WebkitBackdropFilter: scrolled ? 'blur(var(--glass-blur))' : 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 var(--space-6)',
          transition: 'background 400ms var(--ease-default), backdrop-filter 400ms var(--ease-default)',
        }}>

        {/* Effects layer — clipped so spotlight doesn't bleed */}
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          {/* Cursor spotlight */}
          <div
            ref={spotlightRef}
            style={{
              position: 'absolute',
              top: 0,
              width: 240,
              height: '100%',
              background: 'radial-gradient(ellipse at center, rgba(255, 255, 255, 0.05) 0%, transparent 70%)',
              opacity: 0,
              transition: 'opacity 350ms var(--ease-default)',
            }}
          />

          {/* Animated gradient border */}
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 1,
            background: 'linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.2) 20%, rgba(255, 255, 255, 0.3) 50%, rgba(255, 255, 255, 0.2) 80%, transparent 100%)',
            backgroundSize: '200% 100%',
            animation: 'gradient-sweep 6s linear infinite',
            opacity: scrolled ? 0.85 : 0.3,
            transition: 'opacity 400ms var(--ease-default)',
          }} />
        </div>

        {/* Content */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: 1120, position: 'relative' }}>
          <LogoMark />

          {/* Center: links + sliding pill */}
          <div ref={linksRef} style={{ position: 'relative', display: 'flex', gap: 4, alignItems: 'center' }}>
            {/* Sliding pill indicator */}
            <div style={{
              position: 'absolute',
              top: '50%',
              transform: 'translateY(-50%)',
              left: pill.left,
              width: pill.width,
              height: 36,
              borderRadius: 'var(--radius-md)',
              background: 'rgba(255, 255, 255, 0.06)',
              boxShadow: '0 0 20px rgba(255, 255, 255, 0.08), inset 0 0 0 1px rgba(255, 255, 255, 0.05)',
              transition: 'left 400ms var(--ease-spring), width 400ms var(--ease-spring), opacity 300ms var(--ease-default)',
              opacity: pill.opacity,
              pointerEvents: 'none',
            }} />

            {NAV_LINKS.map((l, i) => (
              <div key={l.path} ref={el => { linkRefs.current[i] = el }} style={{ display: 'flex' }}>
                <NavLink
                  to={l.path}
                  label={l.label}
                  active={location.pathname.startsWith(l.path)}
                  entranceDelay={80 + i * 60}
                />
              </div>
            ))}
          </div>

          {/* Right: auth */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-2-5)',
            animation: 'fade-up 450ms var(--ease-default) 380ms both',
          }}>
            {user ? (
              <>
                <img
                  src={`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=32`}
                  alt={`${user.username}'s avatar`}
                  style={{
                    width: 28, height: 28,
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                  }}
                />
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-2)', fontWeight: 'var(--weight-medium)' }}>{user.username}</span>
                <button
                  onClick={logout}
                  aria-label="Log out"
                  title="Log out"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: 'var(--text-xs)', color: 'var(--fg-3)', cursor: 'pointer',
                    padding: '5px 8px', borderRadius: 'var(--radius-sm)',
                    border: '1px solid transparent', background: 'transparent',
                    transition: 'all 180ms var(--ease-default)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--error)'; e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.background = 'var(--error-subtle)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--fg-3)'; e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent' }}
                >
                  <LogOut size={13} />
                </button>
              </>
            ) : (
              <a
                href={loginUrl}
                className="nav-login"
                onMouseEnter={() => setLoginHover(true)}
                onMouseLeave={() => setLoginHover(false)}
                style={{
                  position: 'relative',
                  overflow: 'hidden',
                  display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1-5)',
                  fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)',
                  color: 'var(--accent-fg)',
                  background: loginHover ? 'var(--accent-hover)' : 'var(--accent)',
                  height: 36, padding: '0 18px', borderRadius: 'var(--radius-md)',
                  textDecoration: 'none',
                  boxShadow: loginHover
                    ? '0 4px 24px rgba(255, 255, 255, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1px 0 rgba(255,255,255,0.2)'
                    : '0 2px 8px rgba(255, 255, 255, 0.13), inset 0 1px 0 rgba(255,255,255,0.1)',
                  transition: 'all 220ms var(--ease-spring)',
                  transform: loginHover ? 'translateY(-1.5px)' : 'translateY(0)',
                }}
              >
                <LogIn size={13} style={{ position: 'relative' }} />
                <span style={{ position: 'relative' }}>Login</span>
              </a>
            )}
          </div>
        </div>
      </nav>

      <div style={{ position: 'relative', zIndex: 1 }}>
        {children}
      </div>

      <footer style={{ position: 'relative', zIndex: 1, borderTop: '1px solid var(--border-default)', marginTop: 'var(--space-16, 64px)' }}>
        <div style={{ maxWidth: 1160, margin: '0 auto', padding: '28px clamp(16px, 4vw, 40px)', display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between', alignItems: 'center', fontSize: 'var(--text-sm)', color: 'var(--fg-3)' }}>
          <span>sonder. Your server's data is deleted 30 days after the bot leaves.</span>
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }}>
            <Link to="/commands" style={{ color: 'inherit', textDecoration: 'none' }}>Commands</Link>
            <Link to="/dashboard" style={{ color: 'inherit', textDecoration: 'none' }}>Dashboard</Link>
            <Link to="/switch" style={{ color: 'inherit', textDecoration: 'none' }}>Switch to sonder</Link>
            <Link to="/terms" style={{ color: 'inherit', textDecoration: 'none' }}>Terms</Link>
            <Link to="/privacy" style={{ color: 'inherit', textDecoration: 'none' }}>Privacy</Link>
          </span>
        </div>
      </footer>
    </div>
  )
}

export { NOISE_SVG }
