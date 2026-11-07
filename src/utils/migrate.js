// Helpers for /migrate. Other bots expose no export API, so migration means: find which bots are present,
// avoid command clashes, and reuse the channels the server already has instead of making new ones.

// Default prefixes of common bots (from each bot's own docs / our research notes). Servers can change them,
// so these are reported as "default" and only ever produce a warning, never an automatic change.
const KNOWN_BOTS = [
  { match: /^greed\b/i, name: 'Greed', prefix: ',' },
  { match: /^jar\b/i, name: 'Jar', prefix: ',,' },
  { match: /^mee6\b/i, name: 'MEE6', prefix: '!' },
  { match: /^carl[- ]?bot\b/i, name: 'Carl-bot', prefix: '!' },
  { match: /^dyno\b/i, name: 'Dyno', prefix: '?' },
  { match: /^yagpdb\b/i, name: 'YAGPDB', prefix: '-' },
];

function detectBots(botNames) {
  const found = [];
  for (const raw of botNames) {
    const hit = KNOWN_BOTS.find((b) => b.match.test(raw));
    if (hit && !found.some((f) => f.name === hit.name)) found.push(hit);
  }
  return found;
}

// Does Sonder's prefix collide with (or sit inside) another bot's default prefix?
function prefixClash(sonderPrefix, bots) {
  return bots.filter((b) => b.prefix === sonderPrefix);
}

// Channel names that usually mean "this is the log / welcome channel" in existing servers.
const CHANNEL_HINTS = {
  modlog_channel: /^(?:[\W_]*)(?:mod[-_ ]?logs?|moderation[-_ ]?logs?|audit[-_ ]?logs?|logs?|staff[-_ ]?logs?)(?:[\W_]*)$/i,
  welcome_channel: /^(?:[\W_]*)(?:welcome|welcomes|arrivals?|new[-_ ]?members?|join[-_ ]?logs?|greetings?)(?:[\W_]*)$/i,
  goodbye_channel: /^(?:[\W_]*)(?:goodbyes?|farewells?|leaves?|departures?)(?:[\W_]*)$/i,
};

// channels: [{ id, name }]. Returns { configKey: channelEntry } for the first match per key.
function suggestChannels(channels) {
  const out = {};
  for (const [key, re] of Object.entries(CHANNEL_HINTS)) {
    const hit = channels.find((c) => re.test(c.name));
    if (hit) out[key] = hit;
  }
  return out;
}

module.exports = { KNOWN_BOTS, detectBots, prefixClash, suggestChannels };
