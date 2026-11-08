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

// Query-only places (not settable with /timezone, but fine to tell the time for).
const EXTRA = new Map(Object.entries({
  moscow: 'Europe/Moscow', istanbul: 'Europe/Istanbul', cairo: 'Africa/Cairo', lagos: 'Africa/Lagos',
  nairobi: 'Africa/Nairobi', karachi: 'Asia/Karachi', dhaka: 'Asia/Dhaka', bangkok: 'Asia/Bangkok',
  jakarta: 'Asia/Jakarta', manila: 'Asia/Manila', 'hong kong': 'Asia/Hong_Kong', beijing: 'Asia/Shanghai',
  shanghai: 'Asia/Shanghai', seoul: 'Asia/Seoul', auckland: 'Pacific/Auckland', mexico: 'America/Mexico_City',
  vancouver: 'America/Vancouver', riyadh: 'Asia/Riyadh', doha: 'Asia/Qatar', kathmandu: 'Asia/Kathmandu',
  colombo: 'Asia/Colombo', lisbon: 'Europe/Lisbon', dublin: 'Europe/Dublin',
}));

// "mofu what time is it in dubai" -> a fixed answer computed from the clock, never from the model (chat models
// guess clocks wrong). null unless it is clearly a time-in-<known place> question that names the bot.
function answerTimeQuestion(content, now = new Date()) {
  if (typeof content !== 'string' || content.length > 120) return null;
  const m = content.match(/\bwhat(?:'s|s| is)?\s+(?:the\s+)?(?:current\s+)?time\s+(?:is\s+it\s+)?(?:right\s+now\s+)?(?:in|at)\s+([a-z .]+?)\s*[?.!]*\s*$/i);
  if (!m) return null;
  const place = m[1].toLowerCase().replace(/^the\s+/, '').replace(/\s+/g, ' ').trim();
  const zone = LOOKUP.get(place) || EXTRA.get(place);
  if (!zone) return null;
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true });
  return `It is ${fmt.format(now)} in ${place.replace(/\b\w/g, (c) => c.toUpperCase())} (${zone.replace('_', ' ')}).`;
}

module.exports = { parseTimezoneIntent, answerTimeQuestion };
