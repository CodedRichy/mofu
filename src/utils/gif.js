const log = require('./logger');

const API_BASE = 'https://nekos.best/api/v2';

const TYPE_MAP = {
  bite: 'bite',
  bonk: 'punch',
  hug: 'hug',
  kiss: 'kiss',
  pat: 'pat',
  slap: 'slap',
  cuddle: 'cuddle',
  poke: 'poke',
  tickle: 'tickle',
  wave: 'wave',
  wink: 'wink',
  cry: 'cry',
  dance: 'dance',
  blush: 'blush',
  laugh: 'laugh',
  yeet: 'yeet',
  feed: 'feed',
  highfive: 'highfive',
  handhold: 'handhold',
  kick: 'kick',
  smile: 'smile',
  stare: 'stare',
  think: 'think',
  thumbsup: 'thumbsup',
  pout: 'pout',
  nom: 'nom',
  baka: 'baka',
  shoot: 'shoot',
  smug: 'smug',
  nod: 'nod',
  nope: 'nope',
  sleep: 'sleep',
  shrug: 'shrug',
  facepalm: 'facepalm',
  happy: 'happy',
  peck: 'peck',
};

async function fetchGif(type) {
  const endpoint = TYPE_MAP[type] || type;
  try {
    const res = await fetch(`${API_BASE}/${endpoint}`, {
      headers: { 'User-Agent': 'mofu Discord Bot/0.1' },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    return data.results?.[0]?.url || null;
  } catch (err) {
    log.debug(`GIF fetch failed for ${type}: ${err.message}`);
    return null;
  }
}

module.exports = { fetchGif, TYPE_MAP };
