const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };

function parse(str) {
  const match = str.match(/^(\d+)\s*(s|m|h|d|w)$/i);
  if (!match) return null;
  return parseInt(match[1]) * multipliers[match[2].toLowerCase()];
}

// Two units at most ("1h 30m", "1d 12h"), so a 90 minute mute is never reported as "1h".
function format(ms) {
  const units = [['d', 86400000], ['h', 3600000], ['m', 60000], ['s', 1000]];
  let rest = Math.max(0, Math.floor(ms));
  const parts = [];
  for (const [name, size] of units) {
    const n = Math.floor(rest / size);
    if (n > 0) { parts.push(`${n}${name}`); rest -= n * size; }
    if (parts.length === 2) break;
  }
  return parts.join(' ') || '0s';
}

module.exports = { parse, format };
