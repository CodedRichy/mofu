// Image fingerprints and the bounded verdict cache for image checks. Pure helpers.
// A fingerprint is a short hash of the CDN path plus the byte size. Image bytes are never kept here or anywhere
// else: the cache maps fingerprint -> small verdict object and is evicted least-recently-used.
const crypto = require('crypto');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const CACHE_MAX = 500;

// Only Discord-hosted media is ever fetched: attachments, stickers and the proxy copy Discord makes of embed images.
const HOST_OK = [
  /^cdn\.discordapp\.com$/i,
  /^media\.discordapp\.net$/i,
  /^images-ext-\d+\.discordapp\.net$/i,
];
const IMAGE_TYPE = /^image\/(png|jpe?g|webp|gif)(?:;|$)/i;

function isAllowedImageUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' && HOST_OK.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

function isImageType(contentType) {
  return IMAGE_TYPE.test(String(contentType || ''));
}

// Same upload -> same key, whatever the query string (signed CDN urls change on every fetch).
function fingerprint(url, size) {
  let path = String(url || '');
  try { path = new URL(path).pathname; } catch { /* keep raw */ }
  return crypto.createHash('sha1').update(`${path.toLowerCase()}|${Number(size) || 0}`).digest('hex').slice(0, 24);
}

class LruCache {
  constructor(max = CACHE_MAX) { this.max = max; this.map = new Map(); }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }
  has(key) { return this.map.has(key); }
  set(key, value) {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
  get size() { return this.map.size; }
}

module.exports = { MAX_IMAGE_BYTES, CACHE_MAX, isAllowedImageUrl, isImageType, fingerprint, LruCache };
