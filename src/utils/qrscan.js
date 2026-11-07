// QR decoding for the scam shield. Needs the npm package `jsqr` (pure JS). Image decoding reuses
// @napi-rs/canvas, which is already a dependency. If jsqr is not installed this module reports 'unavailable'
// and the shield skips QR checks (text links to discord.com/ra/ are still caught without it).
// Nothing is stored: bytes are decoded in memory and dropped; only a small bounded result cache of hash -> urls.
let jsQR = null;
let canvas = null;
try { jsQR = require('jsqr'); canvas = require('@napi-rs/canvas'); } catch { /* not installed: stub mode */ }

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DIM = 1000;
const FETCH_TIMEOUT_MS = 4000;
const CACHE_MAX = 300;
const HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);
const IMAGE_TYPE = /^image\/(png|jpe?g|webp|gif)/i;

const cache = new Map(); // key -> urls[]

function available() { return Boolean(jsQR && canvas); }

// Decode raw RGBA pixels. Exposed so tests can feed pixel data without an image file.
function decodePixels(data, width, height) {
  if (!jsQR) return { status: 'unavailable', urls: [] };
  const hit = jsQR(data, width, height);
  return hit && hit.data ? { status: 'ok', urls: [String(hit.data)] } : { status: 'ok', urls: [] };
}

async function decodeBuffer(buf) {
  if (!available()) return { status: 'unavailable', urls: [] };
  try {
    const img = await canvas.loadImage(buf);
    const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const c = canvas.createCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h);
    return decodePixels(px.data, w, h);
  } catch {
    return { status: 'error', urls: [] };
  }
}

// attachment: { url, size, contentType }. Only Discord CDN images under the size cap are fetched.
async function scanAttachment(att) {
  if (!available()) return { status: 'unavailable', urls: [] };
  try {
    if (!att || !att.url || !att.size || att.size > MAX_BYTES) return { status: 'skipped', urls: [] };
    if (att.contentType && !IMAGE_TYPE.test(att.contentType)) return { status: 'skipped', urls: [] };
    const u = new URL(att.url);
    if (u.protocol !== 'https:' || !HOSTS.has(u.hostname)) return { status: 'skipped', urls: [] };
    const key = `${att.size}|${u.pathname}`;
    if (cache.has(key)) return { status: 'ok', urls: cache.get(key) };
    const res = await fetch(att.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return { status: 'error', urls: [] };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) return { status: 'skipped', urls: [] };
    const out = await decodeBuffer(buf);
    if (out.status === 'ok') {
      cache.set(key, out.urls);
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    }
    return out;
  } catch {
    return { status: 'error', urls: [] };
  }
}

module.exports = { available, decodePixels, decodeBuffer, scanAttachment };
