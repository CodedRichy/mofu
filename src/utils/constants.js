// Brand name shown to users. Always lowercase, also at the start of a sentence.
const BRAND = 'mofu';
// Words the bot answers to in chat. 'sonder' is the old name, kept while servers get used to the new one.
const TRIGGER_WORDS = Object.freeze(['mofu', 'sonder']); // brand-ok: old name still answers in chat during the transition
// Regex alternation of the trigger words (plain lowercase letters, nothing to escape).
const TRIGGER_ALT = TRIGGER_WORDS.join('|');
// Private log channel the bot creates. Servers set up before the rename have the old name; reuse that one
// instead of creating a second log channel.
const LOG_CHANNEL = `${BRAND}-logs`;
const LEGACY_CHANNEL_NAMES = Object.freeze({ [LOG_CHANNEL]: ['sonder-logs'] }); // brand-ok: channel name created before the rename
// Every name a bot-created channel may have: the current one first, then older ones.
const channelNames = (name) => [name, ...(LEGACY_CHANNEL_NAMES[name] || [])];

module.exports = {
  BRAND,
  TRIGGER_WORDS,
  TRIGGER_ALT,
  LOG_CHANNEL,
  channelNames,
  colors: {
    primary: 0xffffff,
    success: 0x22c55e,
    warning: 0xfbbf24,
    error: 0xf87171,
    info: 0x6366f1,
    muted: 0x6b7280,
  },
  icons: {
    success: '✓',
    error: '✗',
    arrow: '▸',
    dot: '・',
    divider: '─────────────────────',
  },
};
