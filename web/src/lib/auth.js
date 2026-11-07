import { useSyncExternalStore } from 'react'
import { CLIENT_ID } from './invite'

const KEY = 'sonder_token'
const EVENT = 'sonder-auth'
const STATE_KEY = 'sonder_oauth_state'

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

// OAuth `state` (CSRF): one random value per browser session, checked once on the callback.
function randomState() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export function getOAuthState() {
  try {
    let s = sessionStorage.getItem(STATE_KEY)
    if (!s) { s = randomState(); sessionStorage.setItem(STATE_KEY, s) }
    return s
  } catch {
    return randomState()
  }
}

// True only when the returned state matches the one we issued. Consumes it either way.
export function verifyOAuthState(returned) {
  try {
    const expected = sessionStorage.getItem(STATE_KEY)
    sessionStorage.removeItem(STATE_KEY)
    return !!expected && !!returned && expected === returned
  } catch {
    return false
  }
}

export function loginUrl() {
  const redirect = encodeURIComponent(window.location.origin + '/dashboard')
  return `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${redirect}&response_type=code&scope=identify+guilds&state=${getOAuthState()}`
}
