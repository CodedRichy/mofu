// Natural-language music commands: "sonder skip", "yo sonder play despacito".
// Pure matcher: returns { verb, args } for the prefix command to run, or null when the sentence is
// ordinary conversation. It is deliberately strict: a wrong "no" costs one retyped command, a wrong
// "yes" stops the music for a whole voice channel.

const BARE_VERBS = new Set(['stop', 'skip', 'pause', 'resume', 'shuffle', 'queue', 'nowplaying']);
const LOOP_MODES = new Set(['off', 'track', 'queue', 'autoplay', 'song', 'none']);

// First word of a play request that means this is a sentence, not a song title.
const PLAY_STOP_START = new Set([
  'it', 'that', 'this', 'these', 'those', 'me', 'us', 'my', 'our', 'your', 'you', 'i', 'we', 'he', 'she', 'they',
  'along', 'around', 'nice', 'dumb', 'fair', 'dead', 'hard', 'safe', 'smart', 'cool', 'cute', 'games', 'game',
  'with', 'for', 'again', 'to', 'on', 'in', 'at', 'of', 'as', 'by', 'up', 'down', 'out', 'back',
  'nothing', 'something', 'anything', 'well', 'ball', 'pretend', 'favorites', 'favourites',
  // Hinglish
  'kar', 'karo', 'kro', 'kr', 'mat', 'nahi', 'nhi', 'mujhe', 'mera', 'meri', 'yaar', 'bhai', 'ab',
  // Spanish
  'con', 'para', 'por', 'que', 'mi', 'no', 'nada', 'conmigo', 'bien', 'limpio', 'sucio',
]);

// Articles are fine ('the weeknd', 'a sky full of stars') unless they start a known idiom ('the fool', 'the game').
const ARTICLES = new Set(['the', 'a', 'an']);
const ARTICLE_IDIOMS = new Set(['fool', 'game', 'games', 'part', 'victim', 'role', 'hero', 'devil', 'long', 'same', 'field', 'martyr', 'innocent', 'dumb', 'smart', 'hard', 'safe', 'nice', 'cool', 'dead', 'ball', 'card', 'cards', 'trick', 'clown', 'idiot', 'way', 'part']);
// 'bad bunny' is an artist, 'play bad' / 'play good with others' are sentences.
const SOFT_START = new Set(['bad', 'good']);
const SENTENCE_WORDS = new Set(['it', 'with', 'to', 'for', 'along', 'again', 'nice', 'around', 'me', 'us', 'cop', 'guy', 'boy', 'girl', 'at', 'in', 'on', 'now']);
// Explicit phrases for the bare verbs: 'stop the music', 'skip this song'.
const VERB_PHRASES = {
  stop: /^(?:the\s+)?(?:music|song|track|player|playback)$/i,
  pause: /^(?:the\s+)?(?:music|song|track|player|playback)$/i,
  resume: /^(?:the\s+)?(?:music|song|track|player|playback)$/i,
  skip: /^(?:this|the\s+(?:song|track|current\s+(?:song|track)))(?:\s+(?:song|track|one))?$/i,
};

const CLAUSE_MARKERS = [
  /,\s*(?:i|you|we|he|she|they|it|that|this|but|and|so|because|why|what)\b/i,
  /\sbeing\s/i, /\slike\s/i, /\sso\s/i, /\sbecause\s/i, /\sbut\s/i, /\sif\s/i, /\swhen\s/i,
  /\?\s*$/,
];

function stripTrailing(s) {
  return s.replace(/\s*(?:please|pls|plz|now)?\s*[.!]*\s*$/i, '').trim();
}

function norm(word) {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function parseMusicIntent(content, botId) {
  if (typeof content !== 'string' || !content || content.length > 300) return null;
  const mention = botId ? `<@!?${botId}>` : '(?!)';
  const re = new RegExp(`^\\s*(?:(?:hey|yo)\\s+)?(?:sonder|${mention})[,:]?\\s+(play|skip|pause|resume|stop|queue|shuffle|loop|volume|nowplaying)\\b(.*)$`, 'is');
  const m = content.match(re);
  if (!m) return null;

  const verb = m[1].toLowerCase();
  const rest = stripTrailing(m[2].trim());

  if (BARE_VERBS.has(verb)) {
    if (rest && !(VERB_PHRASES[verb] && VERB_PHRASES[verb].test(rest))) return null;
    return { verb: verb === 'resume' ? 'pause' : verb, args: '' };
  }

  if (!rest) return null;

  if (verb === 'loop') {
    const mode = rest.toLowerCase();
    if (!LOOP_MODES.has(mode)) return null;
    return { verb, args: mode === 'song' ? 'track' : mode === 'none' ? 'off' : mode };
  }

  if (verb === 'volume') {
    const n = rest.match(/^(?:to\s+|at\s+)?(\d{1,3})\s*%?$/i);
    if (!n) return null;
    const level = parseInt(n[1], 10);
    return level >= 1 && level <= 100 ? { verb, args: String(level) } : null;
  }

  // play
  const quoted = /^["“].+["”]$/.test(rest);
  if (!quoted && CLAUSE_MARKERS.some((r) => r.test(` ${rest}`))) return null;
  if (/^[,:;]/.test(rest)) return null;
  const tokens = rest.replace(/^["“]|["”]$/g, '').split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const isUrl = /^https?:\/\//i.test(rest);
  if (!isUrl) {
    const first = norm(tokens[0]);
    const second = tokens[1] ? norm(tokens[1]) : '';
    if (PLAY_STOP_START.has(first)) return null;
    if (ARTICLES.has(first) && (tokens.length < 2 || ARTICLE_IDIOMS.has(second))) return null;
    if (SOFT_START.has(first) && (tokens.length < 2 || SENTENCE_WORDS.has(second))) return null;
    if (!tokens.some((t) => !PLAY_STOP_START.has(norm(t)) && !ARTICLES.has(norm(t)))) return null;
  }
  return { verb, args: rest };
}

module.exports = { parseMusicIntent };
