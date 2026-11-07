// Antilink helpers: compare the real hostname of each URL, never a substring of the message.

const URL_RE = /https?:\/\/[^\s<>"']+/gi;

function extractUrls(content) {
  return String(content || '').match(URL_RE) || [];
}

// "https://www.YouTube.com/watch" -> { host: 'youtube.com', path: '/watch' }; plain "discord.gg/abc" works too.
function parseEntry(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//.test(s) ? s : `http://${s}`);
    const host = u.hostname.replace(/^www\./, '');
    if (!host) return null;
    const p = u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '');
    return { host, path: p };
  } catch { return null; }
}

function isUrlWhitelisted(url, whitelist) {
  let u;
  try { u = new URL(url); } catch { return false; }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname.toLowerCase();
  for (const raw of whitelist || []) {
    const e = parseEntry(raw);
    if (!e) continue;
    if (host !== e.host && !host.endsWith(`.${e.host}`)) continue;
    if (e.path && !(path === e.path || path.startsWith(`${e.path}/`))) continue;
    return true;
  }
  return false;
}

// True when the message holds at least one URL that is not on the whitelist.
function hasBlockedLink(content, whitelist) {
  return extractUrls(content).some((u) => !isUrlWhitelisted(u, whitelist));
}

module.exports = { extractUrls, isUrlWhitelisted, hasBlockedLink };
