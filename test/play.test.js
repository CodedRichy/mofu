const test = require('node:test');
const assert = require('node:assert');
const { normalizeQuery } = require('../src/commands/music/play');

test('drops a YouTube Mix (list=RD) when the link names a video', () => {
  assert.strictEqual(normalizeQuery('https://youtu.be/_d2Yux449ds?list=RD_d2Yux449ds'), 'https://youtu.be/_d2Yux449ds');
  assert.strictEqual(
    normalizeQuery('https://www.youtube.com/watch?v=abc123&list=RDabc123&start_radio=1'),
    'https://www.youtube.com/watch?v=abc123',
  );
});

test('keeps real playlists, plain searches and other sites untouched', () => {
  const pl = 'https://www.youtube.com/playlist?list=PLxyz';
  assert.strictEqual(normalizeQuery(pl), pl);
  const watchPl = 'https://www.youtube.com/watch?v=abc123&list=PLxyz';
  assert.strictEqual(normalizeQuery(watchPl), watchPl);
  assert.strictEqual(normalizeQuery('let me love you dj snake'), 'let me love you dj snake');
  assert.strictEqual(normalizeQuery('https://open.spotify.com/track/1?list=RD1'), 'https://open.spotify.com/track/1?list=RD1');
});

test('only real YouTube hosts get the Mix cleanup', () => {
  const mix = 'watch?v=abc123&list=RDabc123';
  for (const host of ['notyoutube.com', 'evilyoutube.com', 'youtube.com.evil.io', 'fakeyoutu.be']) {
    const u = `https://${host}/${mix}`;
    assert.strictEqual(normalizeQuery(u), u, host);
  }
  for (const host of ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']) {
    assert.strictEqual(normalizeQuery(`https://${host}/${mix}`), `https://${host}/watch?v=abc123`, host);
  }
});
