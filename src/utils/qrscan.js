// QR decoding for the scam shield and image checks. Decoder: the npm package `jsqr` (pure JS). PNG and JPEG are
// decoded with the pure-JS `pngjs` and `jpeg-js`; other formats (webp, gif) go through @napi-rs/canvas when it
// loads. If jsqr is missing this module reports 'unavailable' and callers skip QR checks (text links to
// discord.com/ra/ are still caught without it).
// Nothing is stored: bytes are decoded in memory and dropped; only a small bounded result cache of hash -> urls.
let jsQR = null;
let canvas = null;
let PNG = null;
let jpeg = null;
try { jsQR = require('jsqr'); } catch { /* not installed: stub mode */ }
try { canvas = require('@napi-rs/canvas'); } catch { /* optional: only webp and gif need it */ }
try { PNG = require('pngjs').PNG; } catch { /* optional */ }
try { jpeg = require('jpeg-js'); } catch { /* optional */ }
const MAX_PIXELS = 20 * 1000 * 1000; // refuse to decode anything larger (memory bomb guard)

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DIM = 1000;
const FETCH_TIMEOUT_MS = 4000;
const CACHE_MAX = 300;
const HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);
const IMAGE_TYPE = /^image\/(png|jpe?g|webp|gif)/i;

const cache = new Map(); // key -> urls[]

function available() { return Boolean(jsQR && (canvas || PNG || jpeg)); }

// Decode raw RGBA pixels. Exposed so tests can feed pixel data without an image file.
function decodePixels(data, width, height) {
  if (!jsQR) return { status: 'unavailable', urls: [] };
  const hit = jsQR(data, width, height);
  return hit && hit.data ? { status: 'ok', urls: [String(hit.data)] } : { status: 'ok', urls: [] };
}

// Nearest-neighbour shrink so jsQR never scans millions of pixels. Returns { data, width, height }.
function shrink(data, width, height) {
  const scale = Math.min(1, MAX_DIM / Math.max(width, height));
  if (scale >= 1) return { data, width, height };
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor(x / scale));
      const si = (sy * width + sx) * 4;
      const di = (y * w + x) * 4;
      out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2]; out[di + 3] = data[si + 3];
    }
  }
  return { data: out, width: w, height: h };
}

function sniff(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  return 'other';
}

async function decodeBuffer(buf) {
  if (!available()) return { status: 'unavailable', urls: [] };
  try {
    const kind = sniff(buf);
    if (kind === 'png' && PNG) {
      const png = PNG.sync.read(buf);
      if (png.width * png.height > MAX_PIXELS) return { status: 'skipped', urls: [] };
      const s = shrink(png.data, png.width, png.height);
      return decodePixels(s.data, s.width, s.height);
    }
    if (kind === 'jpeg' && jpeg) {
      const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 20, maxMemoryUsageInMB: 256 });
      const s = shrink(img.data, img.width, img.height);
      return decodePixels(s.data, s.width, s.height);
    }
    if (!canvas) return { status: 'skipped', urls: [] };
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

module.exports = { available, decodePixels, decodeBuffer, scanAttachment, sniff, shrink };
