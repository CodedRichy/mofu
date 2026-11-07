import { useSyncExternalStore } from 'react'

const KEY = 'sonder_token'
const EVENT = 'sonder-auth'

export function getToken() {
  try { return localStorage.getItem(KEY) } catch { return null }
}

function emit() {
  window.dispatchEvent(new Event(EVENT))
}

export function setToken(t) {
  try { localStorage.setItem(KEY, t) } catch { /* storage blocked */ }
  emit()
}

export function clearToken() {
  try { localStorage.removeItem(KEY) } catch { /* storage blocked */ }
  emit()
}

function subscribe(cb) {
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

// Reactive token: components re-render after login/logout in this tab or any other.
export function useToken() {
  return useSyncExternalStore(subscribe, getToken, () => null)
}

// OAuth `state` (CSRF) is created and verified by the server: /api/auth/login sets a signed httpOnly cookie
// and redirects to Discord; /api/auth/callback checks it before touching the code.
export function loginUrl() {
  return '/api/auth/login'
}
