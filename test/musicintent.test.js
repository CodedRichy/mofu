const test = require('node:test');
const assert = require('node:assert');
const { parseMusicIntent } = require('../src/utils/musicIntent');
const { hasBlockedLink, isUrlWhitelisted } = require('../src/utils/linkfilter');
const { setLongTimeout, MAX_DELAY } = require('../src/utils/longTimeout');

const BOT = '123456789012345678';
// The bot answers to 'mofu' and its old name 'sonder'. Every case below is written with 'sonder' and is
// also run with 'mofu' in its place: both names must give exactly the same result.
const asMofu = (s) => s.replace(/sonder/g, 'mofu').replace(/Sonder/g, 'Mofu').replace(/SONDER/g, 'MOFU');
const hit = (s) => {
  const r = parseMusicIntent(s, BOT);
  assert.deepStrictEqual(parseMusicIntent(asMofu(s), BOT), r, `same result for: ${asMofu(s)}`);
  return r;
};

test('both names work, and only as the first word', () => {
  assert.deepStrictEqual(parseMusicIntent('mofu skip', BOT), { verb: 'skip', args: '' });
  assert.deepStrictEqual(parseMusicIntent('yo mofu, play despacito', BOT), { verb: 'play', args: 'despacito' });
  assert.deepStrictEqual(parseMusicIntent('MOFU STOP', BOT), { verb: 'stop', args: '' });
  assert.deepStrictEqual(parseMusicIntent('sonder skip', BOT), { verb: 'skip', args: '' });
  for (const s of ['i told mofu to stop', 'mofus stop', 'mofu stop being weird', 'mofu play it cool', 'mofu, play it cool', 'mofuu skip', 'mmofu skip']) {
    assert.strictEqual(parseMusicIntent(s, BOT), null, s);
  }
});

test('bare verbs match', () => {
  assert.deepStrictEqual(hit('sonder stop'), { verb: 'stop', args: '' });
  assert.deepStrictEqual(hit('yo sonder skip'), { verb: 'skip', args: '' });
  assert.deepStrictEqual(hit('Sonder, pause please'), { verb: 'pause', args: '' });
  assert.deepStrictEqual(hit('sonder resume'), { verb: 'resume', args: '' });
  assert.deepStrictEqual(hit('hey sonder shuffle!'), { verb: 'shuffle', args: '' });
  assert.deepStrictEqual(hit('sonder queue'), { verb: 'queue', args: '' });
  assert.deepStrictEqual(hit('sonder nowplaying'), { verb: 'nowplaying', args: '' });
  assert.deepStrictEqual(hit(`<@${BOT}> skip`), { verb: 'skip', args: '' });
});

test('play with a real argument matches', () => {
  assert.deepStrictEqual(hit('sonder play despacito'), { verb: 'play', args: 'despacito' });
  assert.deepStrictEqual(hit('sonder, play blinding lights by the weeknd'), { verb: 'play', args: 'blinding lights by the weeknd' });
  assert.deepStrictEqual(hit('sonder play https://youtu.be/abc123'), { verb: 'play', args: 'https://youtu.be/abc123' });
  assert.deepStrictEqual(hit('sonder play "like a prayer"'), { verb: 'play', args: '"like a prayer"' });
  assert.deepStrictEqual(hit('sonder play Tum Hi Ho'), { verb: 'play', args: 'Tum Hi Ho' });
  assert.deepStrictEqual(hit('sonder play bailando enrique iglesias'), { verb: 'play', args: 'bailando enrique iglesias' });
});

test('loop and volume only take clean arguments', () => {
  assert.deepStrictEqual(hit('sonder loop queue'), { verb: 'loop', args: 'queue' });
  assert.deepStrictEqual(hit('sonder loop song'), { verb: 'loop', args: 'track' });
  assert.deepStrictEqual(hit('sonder volume 50'), { verb: 'volume', args: '50' });
  assert.deepStrictEqual(hit('sonder volume to 30%'), { verb: 'volume', args: '30' });
  assert.strictEqual(hit('sonder volume 500'), null);
  assert.strictEqual(hit('sonder volume'), null);
  assert.strictEqual(hit('sonder loop'), null);
});

test('ordinary conversation never matches', () => {
  const talk = [
    'sonder stop being weird',
    'sonder stop it',
    'sonder, play it cool',
    'sonder play it again',
    'sonder play along',
    'sonder play nice',
    'sonder play dumb',
    'sonder play the way you do',
    'sonder loop me in',
    'sonder queue up the meeting',
    'sonder skip the intro and tell me about yourself',
    'sonder pause for a second, i need to think',
    'sonder play with me',
    'sonder play around less',
    'sonder play fair',
    'sonder play so you can annoy people',
    'sonder stop because i said so',
    'sonder shuffle my thoughts',
    'sonder volume of the server is crazy',
    'sonder play',
    'sonder stop?',
    // Hinglish
    'sonder stop karo yaar',
    'sonder play karo na',
    'sonder play mat karo',
    'sonder skip kar do isko',
    // Spanish
    'sonder stop, no entiendo',
    'sonder play conmigo',
    'sonder play que bien',
    'sonder queue para mañana',
    // not addressed to the bot
    'please stop',
    'i told sonder to stop',
    'sonders stop',
  ];
  for (const s of talk) assert.strictEqual(hit(s), null, `should not match: ${s}`);
});

test('mention of another user does not count', () => {
  assert.strictEqual(hit('<@999999999999999999> skip'), null);
  assert.strictEqual(parseMusicIntent('sonder skip', undefined) !== null, true);
  assert.strictEqual(parseMusicIntent('mofu skip', undefined) !== null, true);
});

test('antilink compares hostnames, not substrings', () => {
  const wl = ['discord.gg', 'https://www.youtube.com'];
  assert.strictEqual(hasBlockedLink('join https://discord.gg/abc', wl), false);
  assert.strictEqual(hasBlockedLink('https://evil.tld/?x=discord.gg', wl), true);
  assert.strictEqual(hasBlockedLink('https://discord.gg.evil.tld/x', wl), true);
  assert.strictEqual(hasBlockedLink('https://notdiscord.gg/x', wl), true);
  assert.strictEqual(hasBlockedLink('https://music.youtube.com/watch?v=1', wl), false);
  assert.strictEqual(hasBlockedLink('https://youtube.com/a https://evil.tld/', wl), true);
  assert.strictEqual(hasBlockedLink('no links here', wl), false);
  assert.strictEqual(hasBlockedLink('https://anything.tld', []), true);
  assert.strictEqual(isUrlWhitelisted('https://discord.com/invite/ok', ['discord.com/invite']), true);
  assert.strictEqual(isUrlWhitelisted('https://discord.com/other', ['discord.com/invite']), false);
});

test('long timeout re-arms instead of firing early', () => {
  const real = global.setTimeout;
  const delays = [];
  global.setTimeout = (fn, d) => { delays.push(d); return real(() => {}, 0); };
  try {
    setLongTimeout(() => {}, 30 * 86400000);
  } finally { global.setTimeout = real; }
  assert.strictEqual(delays.length, 1);
  assert.ok(delays[0] <= MAX_DELAY);
});

test('artists and titles that start with an article or "bad" match', () => {
  for (const [s, args] of [
    ['sonder play the weeknd', 'the weeknd'],
    ['sonder play bad bunny', 'bad bunny'],
    ['sonder play the chainsmokers closer', 'the chainsmokers closer'],
    ['sonder play a sky full of stars', 'a sky full of stars'],
    ['yo sonder, play the beatles', 'the beatles'],
    ['sonder play good 4 u', 'good 4 u'],
  ]) assert.deepStrictEqual(hit(s), { verb: 'play', args }, s);
});

test('explicit phrases stop/skip/pause work, other trailing words do not', () => {
  assert.deepStrictEqual(hit('sonder stop the music'), { verb: 'stop', args: '' });
  assert.deepStrictEqual(hit('sonder skip this'), { verb: 'skip', args: '' });
  assert.deepStrictEqual(hit('sonder skip this song'), { verb: 'skip', args: '' });
  assert.deepStrictEqual(hit('sonder skip this track please'), { verb: 'skip', args: '' });
  assert.deepStrictEqual(hit('sonder skip this one'), { verb: 'skip', args: '' });
  assert.deepStrictEqual(hit('sonder pause the music'), { verb: 'pause', args: '' });
  for (const s of ['sonder stop the madness', 'sonder skip this part', 'sonder skip this conversation', 'sonder stop this', 'sonder skip the intro', 'sonder stop the music lol im joking']) {
    assert.strictEqual(hit(s), null, s);
  }
});

test('idioms starting with an article or pronoun stay conversation', () => {
  for (const s of [
    'sonder play it cool', 'sonder, play it cool', 'sonder play the fool', 'sonder play the game', 'sonder play the part',
    'sonder play the victim', 'sonder play the', 'sonder play a', 'sonder play bad', 'sonder play good with others',
    'sonder stop being weird', 'sonder loop me in', 'sonder queue up the meeting', 'sonder play my part',
  ]) assert.strictEqual(hit(s), null, s);
});
