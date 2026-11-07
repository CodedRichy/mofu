const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const A = require('../src/utils/alerts');
const alertsDb = require('../src/database/alerts');

const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Dev &amp; Co</title>
<item><title><![CDATA[Hello <world>]]></title><link>https://ex.com/a</link><guid>g-1</guid><dc:creator>Kai</dc:creator><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate></item>
<item><title>Second &#38; third</title><link>javascript:alert(1)</link><guid isPermaLink="false">g-2</guid><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate></item>
</channel></rss>`;

const ATOM = `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom"><title>Chan</title>
<author><name>Chan</name></author>
<entry><id>yt:video:abc</id><yt:videoId>abc</yt:videoId><title>Vid One</title><link rel="alternate" href="https://www.youtube.com/watch?v=abc"/><author><name>Chan</name></author><published>2026-11-05T12:00:00+00:00</published><updated>2026-11-05T12:30:00+00:00</updated></entry>
<entry><id>yt:video:def</id><title>Vid Two</title><link rel="alternate" href="https://www.youtube.com/watch?v=def"/><published>2026-11-06T12:00:00+00:00</published></entry>
</feed>`;

test('parses RSS', () => {
  const f = A.parseFeed(RSS);
  assert.equal(f.title, 'Dev & Co');
  assert.equal(f.entries.length, 2);
  assert.equal(f.entries[0].title, 'Hello <world>');
  assert.equal(f.entries[0].author, 'Kai');
  assert.equal(f.entries[0].link, 'https://ex.com/a');
  assert.equal(f.entries[0].id, 'g-1');
  assert.equal(f.entries[0].published, Date.parse('2026-11-02T10:00:00Z'));
  assert.equal(f.entries[1].title, 'Second & third');
  assert.equal(f.entries[1].link, ''); // non-http link dropped
});

test('parses Atom (YouTube shape)', () => {
  const f = A.parseFeed(ATOM);
  assert.equal(f.title, 'Chan');
  assert.equal(f.entries.length, 2);
  assert.equal(f.entries[0].id, 'yt:video:abc');
  assert.equal(f.entries[0].link, 'https://www.youtube.com/watch?v=abc');
  assert.equal(f.entries[0].author, 'Chan');
  assert.equal(f.entries[1].author, 'Chan'); // falls back to the feed author
  assert.equal(f.entries[0].published, Date.parse('2026-11-05T12:00:00Z'));
});

test('rejects non-feeds and oversized input, bounds entries', () => {
  assert.throws(() => A.parseFeed('<html><body>hi</body></html>'), /not an RSS/);
  assert.throws(() => A.parseFeed('<rss>' + 'x'.repeat(A.MAX_BODY_BYTES + 1)), /too large/);
  const many = '<rss><channel>' + '<item><guid>i</guid><title>t</title></item>'.repeat(500) + '</channel></rss>';
  assert.ok(A.parseFeed(many).entries.length <= 50);
  const evil = '<rss><item>' + '<link '.repeat(5000);
  const t0 = Date.now();
  A.parseFeed(evil);
  assert.ok(Date.now() - t0 < 1000);
});

test('SSRF guard: addresses', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '2002:7f00:1::1']) {
    assert.equal(A.isPrivateIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(A.isPrivateIp(ip), false, ip);
});

test('SSRF guard: urls', () => {
  for (const u of ['http://localhost/x', 'http://127.0.0.1/x', 'http://2130706433/x', 'http://0x7f.1/x', 'http://[::1]/x', 'http://[::ffff:127.0.0.1]/x',
    'http://169.254.169.254/latest', 'https://example.com:8443/x', 'http://example.com:22/', 'ftp://example.com/x', 'file:///etc/passwd',
    'http://user:pw@example.com/', 'http://intranet/x', 'http://printer.local/x', 'not a url']) {
    assert.equal(A.checkUrl(u).ok, false, u);
  }
  assert.equal(A.checkUrl('https://example.com/feed.xml').ok, true);
  assert.equal(A.checkUrl('http://example.com:80/feed').ok, true);
  assert.equal(A.checkUrl('https://example.com:443/feed').ok, true);
});

test('SSRF guard: DNS result and redirects are re-checked', async () => {
  const pub = async () => [{ address: '93.184.216.34' }];
  const priv = async () => [{ address: '10.0.0.5' }, { address: '93.184.216.34' }];
  await assert.doesNotReject(A.assertPublicUrl('https://example.com/f', pub));
  await assert.rejects(A.assertPublicUrl('https://example.com/f', priv), /Private/);
  const fakeRes = (status, headers, body) => ({ status, ok: status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => body, body: null });
  const redirectToLocal = async (u) => (u.startsWith('https://example.com') ? fakeRes(302, { location: 'http://127.0.0.1/admin' }, '') : fakeRes(200, {}, 'x'));
  await assert.rejects(A.fetchText('https://example.com/f', { fetchImpl: redirectToLocal, lookup: pub }), /Private|Local/);
  const big = async () => fakeRes(200, { 'content-length': String(A.MAX_BODY_BYTES + 1) }, '');
  await assert.rejects(A.fetchText('https://example.com/f', { fetchImpl: big, lookup: pub }), /too large/);
  const ok = async () => fakeRes(200, {}, RSS);
  assert.equal((await A.fetchText('https://example.com/f', { fetchImpl: ok, lookup: pub })).text, RSS);
});

test('YouTube input classification and page parsing', () => {
  const id = 'UC' + 'a'.repeat(22);
  assert.equal(A.classifyYoutube(id).channelId, id);
  assert.equal(A.classifyYoutube(`https://www.youtube.com/channel/${id}`).channelId, id);
  assert.equal(A.classifyYoutube(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`).channelId, id);
  assert.equal(A.classifyYoutube('@somechannel').pageUrl, 'https://www.youtube.com/@somechannel');
  assert.equal(A.classifyYoutube('https://youtube.com/@some.chan/videos').pageUrl, 'https://www.youtube.com/@some.chan');
  assert.ok(A.classifyYoutube('https://evil.com/@x').error);
  assert.ok(A.classifyYoutube('https://www.youtube.com/watch?v=1').error);
  assert.equal(A.channelIdFromPage(`<link rel="canonical" href="https://www.youtube.com/channel/${id}">`), id);
  assert.equal(A.channelIdFromPage(`..."externalId":"${id}"...`), id);
  assert.equal(A.channelIdFromPage('<html></html>'), null);
  assert.equal(A.youtubeFeedUrl(id), `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
});

test('no old items on first run, dedupe afterwards', () => {
  const feed = A.parseFeed(ATOM);
  const since = Date.parse('2026-11-08T00:00:00Z');
  // seeded at add time: nothing posts
  const seen = A.mergeSeen(feed.entries, []);
  assert.deepEqual(A.selectNew(feed.entries, seen, since), []);
  // even with an empty seen list, items published before the subscription are skipped
  assert.deepEqual(A.selectNew(feed.entries, [], since), []);
  // a new video appears after subscribing
  const fresh = { id: 'yt:video:new', title: 'New', link: '', author: '', published: since + 60000 };
  const next = [fresh, ...feed.entries];
  const got = A.selectNew(next, seen, since);
  assert.deepEqual(got.map((e) => e.id), ['yt:video:new']);
  // after it is recorded as seen it does not post again
  assert.deepEqual(A.selectNew(next, A.mergeSeen(next, seen), since), []);
  // undated item that was not seen posts once; flood is capped
  const flood = Array.from({ length: 10 }, (_, i) => ({ id: `f${i}`, title: 't', published: since + 1000 + i }));
  assert.equal(A.selectNew(flood, [], since).length, A.MAX_POSTS_PER_SWEEP);
  assert.ok(A.mergeSeen(Array.from({ length: 300 }, (_, i) => ({ id: `x${i}` })), []).length <= 100);
});

test('backoff and auto-disable', () => {
  const now = 1000000;
  assert.deepEqual(A.nextState(3, true, now).fails, 0);
  const a = A.nextState(0, false, now);
  const b = A.nextState(1, false, now);
  assert.ok(b.nextCheck - now > a.nextCheck - now);
  assert.equal(A.nextState(A.MAX_FAILURES - 2, false, now).disable, false);
  assert.equal(A.nextState(A.MAX_FAILURES - 1, false, now).disable, true);
  assert.ok(A.nextState(8, false, now).nextCheck - now <= 6 * 60 * 60 * 1000);
});

test('subscription limit, duplicates, failure disable, due query', () => {
  const db = new Database(':memory:');
  const s = alertsDb.create(db);
  const mk = (n) => ({ kind: 'rss', feedUrl: `https://ex.com/${n}.xml`, channelId: 'c1', seen: ['h'], now: 100 });
  for (let i = 0; i < A.MAX_SUBS_PER_GUILD; i++) assert.equal(s.add('g1', mk(i), A.MAX_SUBS_PER_GUILD).ok, true);
  assert.equal(s.add('g1', mk(99), A.MAX_SUBS_PER_GUILD).reason, 'limit');
  assert.equal(s.add('g2', mk(0), A.MAX_SUBS_PER_GUILD).ok, true); // limit is per guild
  assert.equal(s.add('g2', mk(0), A.MAX_SUBS_PER_GUILD).reason, 'duplicate');
  assert.equal(s.count('g1'), A.MAX_SUBS_PER_GUILD);
  assert.equal(s.due(200).length, A.MAX_SUBS_PER_GUILD + 1);
  s.recordFailure('g1', 1, { fails: 10, nextCheck: 0, disable: true, error: 'boom' });
  assert.equal(s.get('g1', 1).enabled, false);
  assert.equal(s.due(200).length, A.MAX_SUBS_PER_GUILD);
  s.recordSuccess('g1', 2, { seen: ['a', 'b'], nextCheck: 5000, label: 'Name' });
  assert.deepEqual(s.get('g1', 2).seen, ['a', 'b']);
  assert.equal(s.get('g1', 2).label, 'Name');
  assert.ok(s.remove('g1', 2));
  // retention covers the table: it has a guild_id column
  assert.ok(db.prepare('PRAGMA table_info(alert_subs)').all().some((c) => c.name === 'guild_id'));
});
