// "mofu set my tz as kolkata" -> { verb: 'timezone', args: 'set Asia/Kolkata' }. Pure matcher like musicIntent.js:
// null for anything that is not a plain "set my timezone" sentence, so chat is never turned into a command.
// Only the zones /timezone offers can be set, so only places that map to one of them are recognised.
const { TRIGGER_ALT } = require('./constants');

const PLACES = [
  ['America/New_York', ['new york', 'nyc', 'et', 'est', 'edt', 'eastern', 'us eastern', 'toronto', 'miami']],
  ['America/Chicago', ['chicago', 'ct', 'cst', 'cdt', 'central', 'us central', 'texas', 'dallas']],
  ['America/Denver', ['denver', 'mt', 'mst', 'mdt', 'mountain', 'us mountain']],
  ['America/Los_Angeles', ['los angeles', 'la', 'pt', 'pst', 'pdt', 'pacific', 'us pacific', 'california', 'seattle']],
  ['Europe/London', ['london', 'uk', 'gmt', 'bst', 'britain', 'england']],
  ['Europe/Berlin', ['berlin', 'cet', 'cest', 'paris', 'madrid', 'rome', 'amsterdam', 'germany', 'france', 'central europe']],
  ['Asia/Kolkata', ['kolkata', 'calcutta', 'india', 'ist', 'delhi', 'mumbai', 'bombay', 'chennai', 'bangalore', 'bengaluru', 'hyderabad', 'pune']],
  ['Asia/Tokyo', ['tokyo', 'jst', 'japan']],
  ['Australia/Sydney', ['sydney', 'aest', 'melbourne', 'australia']],
  ['America/Sao_Paulo', ['sao paulo', 'brt', 'brazil', 'brasilia']],
  ['Asia/Dubai', ['dubai', 'gst', 'uae', 'abu dhabi']],
  ['Asia/Singapore', ['singapore', 'sgt']],
];

const LOOKUP = new Map();
for (const [zone, names] of PLACES) for (const n of names) LOOKUP.set(n, zone);

function parseTimezoneIntent(content, botId) {
  if (typeof content !== 'string' || !content || content.length > 120) return null;
  const mention = botId ? `<@!?${botId}>` : '(?!)';
  const re = new RegExp(`^\\s*(?:(?:hey|yo)\\s+)?(?:${TRIGGER_ALT.replace('mofu', 'mofu+')}|${mention})[,:]?\\s+(?:please\\s+)?(?:set|change|update|make)\\s+(?:my\\s+)?(?:tz|timezone|time\\s*zone)\\s+(?:as|to|is|=)?\\s*(.+?)\\s*[.!]*$`, 'i');
  const m = content.match(re);
  if (!m) return null;
  const place = m[1].toLowerCase().replace(/^the\s+/, '').replace(/\s+/g, ' ').trim();
  const zone = LOOKUP.get(place);
  return zone ? { verb: 'timezone', args: `set ${zone}` } : null;
}

module.exports = { parseTimezoneIntent };
