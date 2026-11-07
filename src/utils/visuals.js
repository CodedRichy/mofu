const { base } = require('./embed');
const { colors } = require('./constants');

const MILESTONES = new Set([10, 25, 50, 100]);

function bar(pct, width = 12) {
  const p = Math.max(0, Math.min(1, Number.isFinite(pct) ? pct : 0));
  const filled = Math.round(p * width);
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// xpPct is 0..1 progress into the new level.
function levelUpEmbed({ client, user, oldLevel, newLevel, xpPct = 0 }) {
  const milestone = MILESTONES.has(newLevel);
  const lines = [
    `**LEVEL UP**  ${oldLevel} -> **${newLevel}**`,
    `${bar(xpPct, 10)} ${Math.round(Math.max(0, Math.min(1, xpPct)) * 100)}%`,
  ];
  if (milestone) lines.unshift('**MILESTONE**');
  return base(client, colors.primary)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setDescription(`<@${user.id}>\n${lines.join('\n')}`);
}

module.exports = { bar, fmt, sleep, levelUpEmbed };
