import { getToken, clearToken } from './auth'

// Never throws. Always resolves to { ok, status, data, error }:
//   ok false + status 0  -> network failure
//   status 401           -> token is cleared (and the page redirected to / unless opts.noRedirect)
export async function api(path, token = getToken(), opts = {}) {
  const { noRedirect, headers, ...init } = opts
  try {
    const r = await fetch(`/api${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
    })
    if (r.status === 401) {
      clearToken()
      if (!noRedirect) window.location.href = '/'
    }
    let data = null
    try { data = await r.json() } catch { /* empty or non-JSON body */ }
    if (!r.ok) return { ok: false, status: r.status, data: null, error: describe(r.status, data) }
    return { ok: true, status: r.status, data, error: null }
  } catch {
    return { ok: false, status: 0, data: null, error: describe(0) }
  }
}

function describe(status, body) {
  if (body && typeof body.error === 'string') return body.error
  if (status === 0) return "Couldn't reach the server. Check your connection and try again."
  if (status === 401) return 'Your session expired. Sign in again.'
  if (status === 403) return "You don't have permission to do that."
  if (status === 404) return 'Not found.'
  return `Something went wrong (${status}).`
}
