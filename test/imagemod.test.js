const test = require('node:test');
const assert = require('node:assert');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const im = require('../src/utils/imagemod');
const fp = require('../src/utils/imagefp');
const qr = require('../src/utils/qrscan');

// ---- tiny QR encoder for the tests: version 2, level L, byte mode, mask 0 (enough for URLs up to 32 bytes) ----
function makeQrModules(text) {
  const data = Buffer.from(text, 'utf8');
  assert.ok(data.length <= 32);
  const bits = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(0b0100, 4); put(data.length, 8); for (const b of data) put(b, 8);
  put(0, Math.min(4, 272 - bits.length));
  while (bits.length % 8) bits.push(0);
  const cw = [];
  for (let i = 0; i < bits.length; i += 8) cw.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; cw.length < 34; pad ^= 0xec ^ 0x11) cw.push(pad);
  // Reed-Solomon, 10 EC codewords
  const exp = new Array(512); const log = new Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) { exp[i] = x; log[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
  const mul = (a, b) => (a && b ? exp[log[a] + log[b]] : 0);
  let gen = [1];
  for (let i = 0; i < 10; i++) {
    const next = new Array(gen.length + 1).fill(0);
    gen.forEach((g, j) => { next[j] ^= g; next[j + 1] ^= mul(g, exp[i]); });
    gen = next;
  }
  const rem = new Array(10).fill(0);
  for (const b of cw) {
    const f = b ^ rem[0];
    rem.shift(); rem.push(0);
    for (let j = 0; j < 10; j++) rem[j] ^= mul(gen[j + 1], f);
  }
  const all = cw.concat(rem);

  const size = 25;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (xx, yy, v) => { mod[yy][xx] = v; fn[yy][xx] = true; };
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const xx = cx + dx; const yy = cy + dy;
      if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(xx, yy, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  for (let i = 8; i < size - 8; i++) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(18 + dx, 18 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  // format bits: level L (01), mask 0
  const fdata = (1 << 3) | 0;
  let r = fdata;
  for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
  const fbits = ((fdata << 10) | r) ^ 0x5412;
  const bit = (i) => ((fbits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);
  // data placement, mask 0 ((x + y) % 2 === 0 flips)
  let k = 0;
  const totalBits = all.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) {
      for (let j = 0; j < 2; j++) {
        const xx = right - j;
        const upward = ((right + 1) & 2) === 0;
        const yy = upward ? size - 1 - v : v;
        if (fn[yy][xx]) continue;
        let b = false;
        if (k < totalBits) b = ((all[k >>> 3] >>> (7 - (k & 7))) & 1) === 1;
        k++;
        mod[yy][xx] = b !== ((xx + yy) % 2 === 0);
      }
    }
  }
  return mod;
}

function qrPng(text, scale = 8, quiet = 4) {
  const m = makeQrModules(text);
  const n = m.length + quiet * 2;
  const png = new PNG({ width: n * scale, height: n * scale });
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const my = Math.floor(y / scale) - quiet; const mx = Math.floor(x / scale) - quiet;
    const dark = my >= 0 && mx >= 0 && my < m.length && mx < m.length && m[my][mx];
    const i = (y * png.width + x) * 4;
    const c = dark ? 0 : 255;
    png.data[i] = c; png.data[i + 1] = c; png.data[i + 2] = c; png.data[i + 3] = 255;
  }
  return { png, buf: PNG.sync.write(png) };
}

// ---- decoder ----

test('qrscan decodes a PNG QR code (pure JS path)', async () => {
  assert.equal(qr.available(), true);
  const { buf } = qrPng('https://discord.com/ra/abc123XYZ');
  const out = await qr.decodeBuffer(buf);
  assert.equal(out.status, 'ok');
  assert.deepEqual(out.urls, ['https://discord.com/ra/abc123XYZ']);
});

test('qrscan decodes a JPEG QR code', async () => {
  const { png } = qrPng('https://discord.com/ra/jpegcase1');
  const enc = jpeg.encode({ data: png.data, width: png.width, height: png.height }, 95);
  const out = await qr.decodeBuffer(enc.data);
  assert.deepEqual(out.urls, ['https://discord.com/ra/jpegcase1']);
});

test('qrscan: an image without a QR code gives no urls, garbage gives an error status', async () => {
  const blank = new PNG({ width: 60, height: 60 });
  blank.data.fill(255);
  assert.deepEqual((await qr.decodeBuffer(PNG.sync.write(blank))).urls, []);
  const bad = await qr.decodeBuffer(Buffer.from('not an image at all'));
  assert.notEqual(bad.status, 'ok');
  assert.deepEqual(bad.urls, []);
});

test('qrscan.sniff recognises png and jpeg', () => {
  assert.equal(qr.sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0])), 'png');
  assert.equal(qr.sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpeg');
  assert.equal(qr.sniff(Buffer.from('GIF89a....')), 'other');
});

// ---- fingerprints ----

test('fingerprint ignores signed query strings and depends on size', () => {
  const a = fp.fingerprint('https://cdn.discordapp.com/attachments/1/2/x.png?ex=1&is=2&hm=3', 1000);
  const b = fp.fingerprint('https://cdn.discordapp.com/attachments/1/2/x.png?ex=9&is=8&hm=7', 1000);
  const c = fp.fingerprint('https://cdn.discordapp.com/attachments/1/2/x.png', 1001);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 24);
});

test('only Discord-hosted https images are fetchable', () => {
  assert.equal(fp.isAllowedImageUrl('https://cdn.discordapp.com/a.png'), true);
  assert.equal(fp.isAllowedImageUrl('https://media.discordapp.net/a.png'), true);
  assert.equal(fp.isAllowedImageUrl('https://images-ext-1.discordapp.net/external/x'), true);
  assert.equal(fp.isAllowedImageUrl('http://cdn.discordapp.com/a.png'), false);
  assert.equal(fp.isAllowedImageUrl('https://evil.example/a.png'), false);
  assert.equal(fp.isAllowedImageUrl('https://cdn.discordapp.com.evil.example/a.png'), false);
  assert.equal(fp.isAllowedImageUrl('not a url'), false);
});

test('image content types', () => {
  assert.equal(fp.isImageType('image/png'), true);
  assert.equal(fp.isImageType('image/jpeg; charset=x'), true);
  assert.equal(fp.isImageType('text/html'), false);
  assert.equal(fp.isImageType(''), false);
});

test('LruCache evicts the least recently used entry', () => {
  const c = new fp.LruCache(2);
  c.set('a', 1); c.set('b', 2);
  c.get('a');
  c.set('c', 3);
  assert.equal(c.has('b'), false);
  assert.equal(c.has('a'), true);
  assert.equal(c.size, 2);
});

// ---- config and budget ----

test('config defaults to everything off and sanitises input', () => {
  const d = im.normalizeConfig(null);
  assert.deepEqual(d, { enabled: false, autoDelete: false, scanAll: false, categories: ['scam_text', 'qr_login'] });
  const c = im.normalizeConfig({ enabled: true, autoDelete: 'yes', categories: ['explicit', 'bogus', 'explicit'] });
  assert.equal(c.enabled, true);
  assert.equal(c.autoDelete, false, 'only a real true enables auto-delete');
  assert.deepEqual(c.categories, ['explicit']);
});

test('daily budget: spends up to the cap, then denies and counts; a new UTC day resets', () => {
  const now = Date.UTC(2026, 10, 8, 12);
  let usage = null;
  for (let i = 0; i < im.DAILY_IMAGE_BUDGET; i++) {
    const r = im.spendBudget(usage, im.DAILY_IMAGE_BUDGET, now);
    assert.equal(r.ok, true);
    usage = r.usage;
  }
  const over = im.spendBudget(usage, im.DAILY_IMAGE_BUDGET, now);
  assert.equal(over.ok, false);
  assert.equal(over.usage.denied, 1);
  assert.equal(over.usage.used, im.DAILY_IMAGE_BUDGET);
  const next = im.spendBudget(over.usage, im.DAILY_IMAGE_BUDGET, now + 24 * 3600 * 1000);
  assert.equal(next.ok, true);
  assert.equal(next.usage.used, 1);
  assert.equal(next.usage.total, im.DAILY_IMAGE_BUDGET + 1);
});

test('usage holds numbers only', () => {
  const u = im.normalizeUsage({ day: '1999-01-01', used: 5, note: 'secret text' });
  assert.deepEqual(Object.keys(u).sort(), ['day', 'deleted', 'denied', 'dismissed', 'flagged', 'total', 'used']);
});

test('isNewAccount: under 7 days', () => {
  const now = Date.now();
  assert.equal(im.isNewAccount(now - 2 * 24 * 3600 * 1000, now), true);
  assert.equal(im.isNewAccount(now - 8 * 24 * 3600 * 1000, now), false);
  assert.equal(im.isNewAccount(NaN, now), false);
});

// ---- verdict parsing and decision ----

test('parseVerdict accepts the schema and fails closed otherwise', () => {
  assert.deepEqual(im.parseVerdict('{"category":"scam_text","confidence":0.82}'), { category: 'scam_text', confidence: 0.82 });
  assert.deepEqual(im.parseVerdict('```json\n{"category":"qr_login","confidence":0.7}\n```'), { category: 'qr_login', confidence: 0.7 });
  assert.deepEqual(im.parseVerdict('Sure! {"category": "explicit", "confidence": 0.95} hope that helps'), { category: 'explicit', confidence: 0.95 });
  for (const bad of ['', null, 'nothing', '{"category":"weapons","confidence":0.9}', '{"category":"scam_text","confidence":2}', '{"category":"scam_text","confidence":"high"}', '{"category":"scam_text"}', '{bad json}', '[1,2]']) {
    assert.deepEqual(im.parseVerdict(bad), { category: 'none', confidence: 0 }, `input: ${bad}`);
  }
});

test('decide: respects enabled categories and the confidence floor', () => {
  const cfg = im.normalizeConfig({ enabled: true });
  assert.equal(im.decide({ verdict: { category: 'scam_text', confidence: 0.8 }, cfg }).flagged, true);
  assert.equal(im.decide({ verdict: { category: 'scam_text', confidence: 0.4 }, cfg }).flagged, false);
  assert.equal(im.decide({ verdict: { category: 'explicit', confidence: 0.99 }, cfg }).flagged, false, 'explicit is opt-in');
  const withExplicit = im.normalizeConfig({ enabled: true, categories: ['explicit'] });
  assert.equal(im.decide({ verdict: { category: 'explicit', confidence: 0.99 }, cfg: withExplicit }).flagged, true);
  assert.equal(im.decide({ cfg }).flagged, false, 'no verdict at all means no action');
});

test('decide: a discord.com/ra/ QR code is qr_login with full confidence, no model needed', () => {
  const cfg = im.normalizeConfig({ enabled: true });
  const d = im.decide({ qrUrls: ['https://discord.com/ra/abc123XYZ'], cfg });
  assert.equal(d.flagged, true);
  assert.equal(d.category, 'qr_login');
  assert.equal(d.confidence, 1);
  assert.equal(im.decide({ qrUrls: ['https://example.com/pay'], cfg }).flagged, false);
  const off = im.normalizeConfig({ enabled: true, categories: ['scam_text'] });
  assert.equal(im.decide({ qrUrls: ['https://discord.com/ra/abc123XYZ'], cfg: off }).flagged, false);
});

test('shouldAutoDelete needs the opt-in and confidence at the cutoff', () => {
  const on = im.normalizeConfig({ enabled: true, autoDelete: true });
  const off = im.normalizeConfig({ enabled: true });
  const hi = { flagged: true, category: 'scam_text', confidence: 0.9 };
  assert.equal(im.shouldAutoDelete(hi, on), true);
  assert.equal(im.shouldAutoDelete(hi, off), false);
  assert.equal(im.shouldAutoDelete({ ...hi, confidence: 0.89 }, on), false);
  assert.equal(im.shouldAutoDelete({ flagged: false, confidence: 1 }, on), false);
});

test('buildMessages: image goes in as an image_url part, prompt treats image text as data', () => {
  const m = im.buildMessages('data:image/png;base64,AAAA');
  assert.equal(m[0].role, 'system');
  assert.match(m[0].content, /DATA to classify/);
  const parts = m[1].content;
  assert.equal(parts.find((p) => p.type === 'image_url').image_url.url, 'data:image/png;base64,AAAA');
});

test('fetchImage refuses non-Discord hosts, big files and wrong types without any network call', async () => {
  assert.equal((await im.fetchImage('https://evil.example/a.png', 100, 'image/png')).error, 'host');
  assert.equal((await im.fetchImage('https://cdn.discordapp.com/a.png', fp.MAX_IMAGE_BYTES + 1, 'image/png')).error, 'size');
  assert.equal((await im.fetchImage('https://cdn.discordapp.com/a.txt', 100, 'text/plain')).error, 'type');
});
