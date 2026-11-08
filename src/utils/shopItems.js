// The shop catalogue: one list for the /shop command and the dashboard, so they cannot disagree.
const ITEMS = [
  { id: 'fishing_rod', name: 'Fishing Rod', price: 500, emoji: '\u{1F3A3}', description: 'Go fishing for extra income' },
  { id: 'laptop', name: 'Laptop', price: 2000, emoji: '\u{1F4BB}', description: 'Permanently earn 50% more from working' },
  { id: 'shield', name: 'Rob Shield', price: 3000, emoji: '\u{1F6E1}\uFE0F', description: 'Blocks one robbery attempt (consumed)' },
  { id: 'lucky_coin', name: 'Lucky Coin', price: 1500, emoji: '\u{1F340}', description: 'Win your next coinflip or slots (consumed)' },
  { id: 'bank_note', name: 'Bank Note', price: 5000, emoji: '\u{1F4B5}', description: 'Permanently increase bank capacity by \u232C10,000' },
];
module.exports = { ITEMS };
