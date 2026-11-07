// Free social alerts: YouTube channel uploads and generic RSS/Atom feeds, posted to a channel when something new
// appears. Pure helpers first (SSRF guard, bounded fetch, feed parser, new-item selection, backoff), then the
// sweep that ties them to the database and Discord.
//
// Privacy: only hashed entry ids and counters are stored, never titles, text or media. Titles are read from the feed
// at post time and go straight into the embed.
const crypto = require('crypto');
const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const log = require('./logger');
const { colors } = require('./constants');

const MAX_SUBS_PER_GUILD = 5;
const SWEEP_MS = 10 * 60 * 1000;
const SWEEP_JITTER_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const MAX_ENTRIES = 50;
const MAX_SEEN = 100;
const MAX_POSTS_PER_SWEEP = 3;
const MAX_FAILURES = 10;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;
const MAX_SUBS_PER_TICK = 200;
const UA = 'mofu-feed-reader (+discord bot)';

// ---- SSRF guard ----

function v4ToInt(ip) {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

const V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([base, bits]) => ({ base: v4ToInt(base), mask: bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0 }));

function isPrivateV4(ip) {
  const n = v4ToInt(ip);
  return V4_BLOCKED.some((r) => ((n & r.mask) >>> 0) === ((r.base & r.mask) >>> 0));
}

function expandV6(ip) {
  let s = ip.split('%')[0].toLowerCase();
  // dotted tail (::ffff:1.2.3.4) -> two hex groups
  const dotted = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const n = v4ToInt(dotted[2]);
    s = `${dotted[1]}${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const fill = tail === undefined ? [] : Array(Math.max(0, 8 - h.length - t.length)).fill('0');
  return [...h, ...fill, ...t].map((g) => parseInt(g || '0', 16));
}

const groupsToV4 = (a, b) => `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;

// True for loopback, private, link-local, CGNAT, multicast, documentation and reserved addresses (v4 and v6).
function isPrivateIp(ip) {
  const s = String(ip).replace(/^\[|\]$/g, '');
  if (net.isIPv4(s)) return isPrivateV4(s);
  if (!net.isIPv6(s)) return true; // not an address we can reason about: refuse
  const g = expandV6(s);
  if (g.length !== 8 || g.some((x) => Number.isNaN(x))) return true;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isPrivateV4(groupsToV4(g[6], g[7])); // mapped / compatible
  if (g[0] === 0x64 && g[1] === 0xff9b) return isPrivateV4(groupsToV4(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return isPrivateV4(groupsToV4(g[1], g[2])); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  return false;
}

// Static check of a URL string: http(s) only, no credentials, ports 80/443 only, no private literal or local name.
// Returns { ok, url, reason }.
function checkUrl(input) {
  let u;
  try { u = new URL(String(input).trim()); } catch { return { ok: false, reason: 'That is not a valid link.' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'Only http and https links are supported.' };
  if (u.username || u.password) return { ok: false, reason: 'Links with a username or password are not allowed.' };
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  if (port !== '80' && port !== '443') return { ok: false, reason: 'Only the standard web ports are allowed.' };
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return { ok: false, reason: 'That link has no host.' };
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home.arpa')) {
    return { ok: false, reason: 'Local addresses are not allowed.' };
  }
  const bare = host.replace(/^\[|\]$/g, '');
  if ((net.isIP(bare) || host.startsWith('[')) && isPrivateIp(bare)) return { ok: false, reason: 'Private addresses are not allowed.' };
  if (!net.isIP(bare) && !host.includes('.')) return { ok: false, reason: 'Local addresses are not allowed.' };
  return { ok: true, url: u.toString() };
}

// Static check plus DNS: every address the name resolves to must be public. `lookup` is injectable for tests.
async function assertPublicUrl(input, lookup = dns.promises.lookup) {
  const c = checkUrl(input);
  if (!c.ok) throw new Error(c.reason);
  const host = new URL(c.url).hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return c.url;
  let addrs;
  try { addrs = await lookup(host, { all: true }); } catch { throw new Error('Could not resolve that host.'); }
  if (!addrs?.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('Private addresses are not allowed.');
  return c.url;
}

// ---- bounded fetch ----

// A DNS lookup for sockets that refuses private answers: the address that is checked is the address that is
// connected to, so a hostname cannot rebind to an internal host between the check and the connection.
function guardedLookup(lookup = dns.promises.lookup) {
  return (host, options, cb) => {
    const done = typeof options === 'function' ? options : cb;
    const wantAll = typeof options === 'object' && options && options.all;
    lookup(host, { all: true }).then((addrs) => {
      if (!addrs?.length || addrs.some((a) => isPrivateIp(a.address))) return done(new Error('Private addresses are not allowed.'));
      if (wantAll) return done(null, addrs);
      return done(null, addrs[0].address, addrs[0].family);
    }, () => done(new Error('Could not resolve that host.')));
  };
}

// Minimal fetch over node:http(s) whose connection uses guardedLookup. Returns the small Response-like object that
// fetchText needs (status, ok, headers.get, text()).
function pinnedFetch(url, init = {}, lookup) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { method: 'GET', headers: init.headers, signal: init.signal, lookup: guardedLookup(lookup) }, (res) => {
      resolve({
        status: res.statusCode,
        ok: res.statusCode >= 200 && res.statusCode < 300,
        headers: { get: (n) => { const v = res.headers[String(n).toLowerCase()]; return v === undefined ? null : String(v); } },
        text: () => new Promise((ok, bad) => {
          const chunks = [];
          let total = 0;
          res.on('data', (c) => {
            total += c.length;
            if (total > MAX_BODY_BYTES) { res.destroy(); bad(new Error('Feed is too large.')); return; }
            chunks.push(c);
          });
          res.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
          res.on('error', bad);
        }),
      });
      if (res.statusCode >= 300 && res.statusCode < 400) res.resume();
    });
    req.on('error', reject);
    req.end();
  });
}

// GET text with an 8s timeout, <=512KB body, redirects followed by hand (each hop re-checked, and the connection
// itself only goes to an address that passed the same check).
async function fetchText(url, opts = {}) {
  const lookup = opts.lookup || dns.promises.lookup;
  const fetchImpl = opts.fetchImpl || ((u, init) => pinnedFetch(u, init, lookup));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs || FETCH_TIMEOUT_MS);
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      current = await assertPublicUrl(current, lookup);
      const res = await fetchImpl(current, {
        redirect: 'manual',
        signal: ctl.signal,
        headers: { 'user-agent': UA, accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5' },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new Error('Bad redirect.');
        current = new URL(loc, current).toString();
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const len = Number(res.headers.get('content-length'));
      if (Number.isFinite(len) && len > MAX_BODY_BYTES) throw new Error('Feed is too large.');
      return { text: await readBounded(res, MAX_BODY_BYTES), finalUrl: current };
    }
    throw new Error('Too many redirects.');
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('Timed out.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function readBounded(res, max) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const t = await res.text();
    if (Buffer.byteLength(t) > max) throw new Error('Feed is too large.');
    return t;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { try { await reader.cancel(); } catch { /* ignore */ } throw new Error('Feed is too large.'); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

// ---- feed parser (RSS 2.0, RSS 1.0 and Atom) ----
// indexOf scanning instead of nested regex, so a hostile document cannot cause catastrophic backtracking.

function blocksOf(xml, tag, max) {
  const out = [];
  let pos = 0;
  const open = `<${tag}`;
  const close = `</${tag}>`;
  while (out.length < max) {
    const a = xml.indexOf(open, pos);
    if (a < 0) break;
    const ch = xml[a + open.length];
    if (ch !== '>' && ch !== ' ' && ch !== '/' && ch !== '\n' && ch !== '\t' && ch !== '\r') { pos = a + open.length; continue; }
    const b = xml.indexOf(close, a);
    if (b < 0) break;
    out.push(xml.slice(a, b + close.length));
    pos = b + close.length;
  }
  return out;
}

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    const cp = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    if (!Number.isFinite(cp) || cp < 32 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return ' ';
    return String.fromCodePoint(cp);
  });
}

const cleanText = (s) => decodeEntities(s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

// Inner text of the first <tag>...</tag> (CDATA unwrapped), or ''.
function tagText(block, tag) {
  const open = `<${tag}`;
  let pos = 0;
  for (;;) {
    const a = block.indexOf(open, pos);
    if (a < 0) return '';
    const ch = block[a + open.length];
    if (ch !== '>' && ch !== ' ' && ch !== '/' && ch !== '\n' && ch !== '\t' && ch !== '\r') { pos = a + open.length; continue; }
    const gt = block.indexOf('>', a);
    if (gt < 0) return '';
    if (block[gt - 1] === '/') return ''; // self-closing
    const end = block.indexOf(`</${tag}>`, gt);
    if (end < 0) return '';
    const inner = block.slice(gt + 1, end);
    const cd = inner.trim();
    if (cd.startsWith('<![CDATA[') && cd.endsWith(']]>')) return cleanText(cd.slice(9, -3));
    return cleanText(inner);
  }
}

function attr(tagSrc, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tagSrc);
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : '';
}

const httpOnly = (u) => { try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:' ? x.toString() : ''; } catch { return ''; } };

function linkOf(block) {
  let pos = 0;
  let fallback = '';
  for (let i = 0; i < 20; i++) {
    const a = block.indexOf('<link', pos);
    if (a < 0) break;
    const gt = block.indexOf('>', a);
    if (gt < 0) break;
    const src = block.slice(a, gt + 1);
    pos = gt + 1;
    const href = attr(src, 'href');
    if (href) {
      const rel = attr(src, 'rel');
      if (!rel || rel === 'alternate') return httpOnly(href);
      continue;
    }
    if (!src.endsWith('/>')) { // RSS style <link>url</link>
      const end = block.indexOf('</link>', gt);
      if (end > 0) fallback = httpOnly(cleanText(block.slice(gt + 1, end).replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '')));
    }
  }
  return fallback;
}

function parseDate(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

const CLIP = (s, n) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

// Returns { title, entries: [{ id, title, link, author, published }] }. Throws if the text is not a feed.
function parseFeed(xml) {
  const src = String(xml || '');
  if (src.length > MAX_BODY_BYTES) throw new Error('Feed is too large.');
  const isFeed = src.indexOf('<rss') >= 0 || src.indexOf('<feed') >= 0 || src.indexOf('<rdf:RDF') >= 0;
  if (!isFeed) throw new Error('That link is not an RSS or Atom feed.');
  const isAtom = src.indexOf('<feed') >= 0 && src.indexOf('<rss') < 0;
  const tag = isAtom ? 'entry' : 'item';
  const first = src.indexOf(`<${tag}`);
  const head = first < 0 ? src : src.slice(0, first);
  const feedAuthor = isAtom ? tagText(tagText2(head, 'author'), 'name') : '';
  const entries = [];
  for (const b of blocksOf(src, tag, MAX_ENTRIES)) {
    const link = linkOf(b);
    const rawId = tagText(b, isAtom ? 'id' : 'guid') || tagText(b, 'yt:videoId') || link;
    const id = CLIP(rawId, 500);
    if (!id) continue;
    const author = isAtom
      ? tagText(tagText2(b, 'author'), 'name')
      : tagText(b, 'dc:creator') || tagText(b, 'author');
    const published = parseDate(tagText(b, isAtom ? 'published' : 'pubDate') || tagText(b, 'dc:date') || tagText(b, 'updated'));
    entries.push({
      id,
      title: CLIP(tagText(b, 'title') || '(untitled)', 250),
      link,
      author: CLIP(author || feedAuthor, 100),
      published,
    });
  }
  return { title: CLIP(tagText(head, 'title'), 100), entries };
}

// raw block (with tags) of the first <tag>...</tag>, used so tagText can look inside <author>
function tagText2(block, tag) {
  const [b] = blocksOf(block, tag, 1);
  return b || '';
}

// ---- YouTube channel resolution ----

const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const CHANNEL_ID = /^UC[\w-]{22}$/;

function youtubeFeedUrl(channelId) {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

// Classify what the person typed. Returns { channelId } when it is already an id, { pageUrl } when the channel page
// has to be fetched, or { error }.
function classifyYoutube(input) {
  const raw = String(input || '').trim();
  if (CHANNEL_ID.test(raw)) return { channelId: raw };
  if (/^@[\w.-]{3,40}$/.test(raw)) return { pageUrl: `https://www.youtube.com/${raw}` };
  let u;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return { error: 'Give me a YouTube channel link, an @handle or a channel id (starts with UC).' }; }
  if (!YT_HOSTS.has(u.hostname.toLowerCase())) return { error: 'That is not a YouTube link.' };
  if (u.pathname === '/feeds/videos.xml') {
    const id = u.searchParams.get('channel_id') || '';
    return CHANNEL_ID.test(id) ? { channelId: id } : { error: 'That feed link has no channel id.' };
  }
  const seg = u.pathname.split('/').filter(Boolean);
  if (seg[0] === 'channel' && CHANNEL_ID.test(seg[1] || '')) return { channelId: seg[1] };
  if (seg[0] && /^@[\w.-]{3,40}$/.test(seg[0])) return { pageUrl: `https://www.youtube.com/${seg[0]}` };
  if ((seg[0] === 'c' || seg[0] === 'user') && /^[\w.-]{1,60}$/.test(seg[1] || '')) return { pageUrl: `https://www.youtube.com/${seg[0]}/${seg[1]}` };
  return { error: 'I could not find a channel in that link. Use the channel page link or its @handle.' };
}

// Pull the channel id out of a channel page (canonical link, meta tag or embedded json).
function channelIdFromPage(html) {
  const s = String(html || '');
  const pats = [
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/,
    /<meta itemprop="(?:channelId|identifier)" content="(UC[\w-]{22})"/,
    /"externalId":"(UC[\w-]{22})"/,
    /"channelId":"(UC[\w-]{22})"/,
  ];
  for (const re of pats) { const m = re.exec(s); if (m) return m[1]; }
  return null;
}

async function resolveYoutube(input, opts = {}) {
  const c = classifyYoutube(input);
  if (c.error) throw new Error(c.error);
  if (c.channelId) return c.channelId;
  const { text } = await fetchText(c.pageUrl, opts);
  const id = channelIdFromPage(text);
  if (!id) throw new Error('I could not read a channel id from that page.');
  return id;
}

// ---- new-item selection, backoff ----

const hashId = (id) => crypto.createHash('sha1').update(String(id)).digest('hex').slice(0, 16);

// Which entries to post. `seen` = hashed ids already handled, `since` = when the subscription started.
// Never returns an entry published before `since`, and never one already seen. Oldest first, capped.
function selectNew(entries, seen, since, cap = MAX_POSTS_PER_SWEEP) {
  const seenSet = new Set(seen);
  const fresh = [];
  for (const e of entries) {
    const h = hashId(e.id);
    if (seenSet.has(h)) continue;
    if (e.published !== null && e.published < since) continue;
    fresh.push(e);
  }
  fresh.sort((a, b) => (a.published ?? 0) - (b.published ?? 0));
  return fresh.slice(-cap);
}

// New seen list: everything in the feed now (posted or skipped) plus the old list, newest first, capped.
function mergeSeen(entries, seen) {
  const out = [];
  const add = (h) => { if (!out.includes(h)) out.push(h); };
  entries.map((e) => hashId(e.id)).forEach(add);
  seen.forEach(add);
  return out.slice(0, MAX_SEEN);
}

// State after a check. Success resets the counter; failure backs off (doubling) and disables at the limit.
function nextState(fails, ok, now) {
  if (ok) return { fails: 0, nextCheck: now + Math.floor(SWEEP_MS * 0.9), disable: false };
  const f = fails + 1;
  return { fails: f, nextCheck: now + Math.min(SWEEP_MS * 2 ** f, MAX_BACKOFF_MS), disable: f >= MAX_FAILURES };
}

// ---- embed ----

function buildEmbed(client, sub, entry) {
  const { base } = require('./embed');
  const e = base(client, sub.kind === 'youtube' ? colors.error : colors.info)
    .setTitle(CLIP(entry.title || '(untitled)', 250));
  if (entry.link) e.setURL(entry.link);
  if (entry.author) e.setAuthor({ name: CLIP(entry.author, 100) });
  const label = sub.label ? CLIP(sub.label, 100) : '';
  e.setDescription(`${sub.kind === 'youtube' ? 'New upload' : 'New post'}${label ? ` from **${label.replace(/[*_`~|>]/g, '')}**` : ''}${entry.link ? `\n${entry.link}` : ''}`);
  if (entry.published) e.setTimestamp(new Date(entry.published));
  return e;
}

// ---- sweep ----

const NO_PINGS = { parse: [] };
let running = false;

async function notifyDisabled(client, sub, reason) {
  try {
    const { response } = require('./embed');
    const store = require('../database/store');
    const guild = client.guilds.cache.get(sub.guildId);
    if (!guild) return;
    const ch = guild.channels.cache.get(store.getConfig(guild.id, 'modlog_channel')) || guild.channels.cache.get(sub.channelId);
    if (!ch?.send) return;
    await ch.send({
      embeds: [response({ client, color: colors.warning, description: `Alert #${sub.id} (${sub.label || sub.kind}) was turned off after ${MAX_FAILURES} failed checks in a row. Last problem: ${reason}. Fix the cause, then add it again.` })],
      allowedMentions: NO_PINGS,
    });
  } catch (err) { log.warn(`alerts: disable note failed: ${err.message}`); }
}

async function processSub(client, db, sub, feedCache, now) {
  const guild = client.guilds.cache.get(sub.guildId);
  if (!guild) return; // bot not in this guild right now; leave the row for retention
  let reason = null;
  let parsed = null;
  try {
    if (!feedCache.has(sub.feedUrl)) feedCache.set(sub.feedUrl, fetchText(sub.feedUrl).then((r) => parseFeed(r.text)));
    parsed = await feedCache.get(sub.feedUrl);
  } catch (err) { reason = String(err.message || err).slice(0, 120); }

  let fresh = [];
  if (parsed) {
    fresh = selectNew(parsed.entries, sub.seen, sub.createdAt);
    const ch = guild.channels.cache.get(sub.channelId);
    if (!ch?.send) reason = 'the channel is gone';
    else if (fresh.length) {
      try {
        for (const entry of fresh) await ch.send({ embeds: [buildEmbed(client, sub, entry)], allowedMentions: NO_PINGS });
      } catch (err) { reason = `could not post (${String(err.message || err).slice(0, 80)})`; }
    }
  }

  if (reason) {
    const st = nextState(sub.fails, false, now);
    db.recordFailure(sub.guildId, sub.id, { fails: st.fails, nextCheck: st.nextCheck, disable: st.disable, error: reason });
    if (st.disable) await notifyDisabled(client, sub, reason);
    return;
  }
  const st = nextState(sub.fails, true, now);
  db.recordSuccess(sub.guildId, sub.id, { seen: mergeSeen(parsed.entries, sub.seen), nextCheck: st.nextCheck, label: !sub.label && parsed.title ? parsed.title : undefined });
}

async function sweepOnce(client, db = require('../database/alerts'), now = Date.now()) {
  if (running) return 0;
  running = true;
  try {
    const due = db.due(now, MAX_SUBS_PER_TICK);
    const feedCache = new Map();
    for (let i = 0; i < due.length; i += 5) {
      await Promise.all(due.slice(i, i + 5).map((s) => processSub(client, db, s, feedCache, now).catch((err) => log.warn(`alerts: sub ${s.guildId}/${s.id}: ${err.message}`))));
    }
    return due.length;
  } finally { running = false; }
}

// Idempotent: calling twice starts one loop. Runs every SWEEP_MS with jitter.
function startSweep(client) {
  if (client._alertsSweep) return;
  client._alertsSweep = true;
  const schedule = (ms) => {
    const t = setTimeout(async () => {
      try { await sweepOnce(client); } catch (err) { log.warn(`alerts sweep failed: ${err.message}`); }
      schedule(SWEEP_MS - SWEEP_JITTER_MS + Math.random() * 2 * SWEEP_JITTER_MS);
    }, ms);
    t.unref?.();
  };
  schedule(30000 + Math.random() * SWEEP_JITTER_MS);
}

module.exports = {
  MAX_SUBS_PER_GUILD, SWEEP_MS, MAX_FAILURES, FETCH_TIMEOUT_MS, MAX_BODY_BYTES, MAX_POSTS_PER_SWEEP,
  isPrivateIp, checkUrl, assertPublicUrl, guardedLookup, pinnedFetch, fetchText, parseFeed, classifyYoutube, channelIdFromPage,
  resolveYoutube, youtubeFeedUrl, hashId, selectNew, mergeSeen, nextState, buildEmbed, sweepOnce, startSweep,
};
