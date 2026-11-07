// Pricing page honesty guard: the AI limits printed in web/src/pages/Pricing.jsx must match the defaults in
// src/utils/aiBudget.js, the commands it lists as free must exist, and the page must never show a price or a
// buy link for mofu (nothing is for sale).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'web', 'src', 'pages', 'Pricing.jsx'), 'utf8');
const { createBudget } = require('../src/utils/aiBudget');

test('footnote limits match aiBudget defaults', () => {
  const b = createBudget({ env: {}, logger: { warn() {}, info() {} } });
  const limits = b.limits || (b.stats && b.stats().limits);
  const src = fs.readFileSync(path.join(root, 'src', 'utils', 'aiBudget.js'), 'utf8');
  const def = (name) => Number(new RegExp(`'${name}',\\s*(\\d+)`).exec(src)[1]);
  if (limits) assert.strictEqual(limits.day, def('AI_GUILD_PER_DAY'));
  assert.ok(page.includes(`${def('AI_GUILD_PER_DAY').toLocaleString('en-US')} AI calls a day`));
  assert.ok(page.includes(`${def('AI_GUILD_CHAT_PER_MIN')} a minute for chat`));
  assert.ok(page.includes(`${def('AI_GUILD_MOD_PER_MIN')} a minute for AI automod`));
});

test('features listed as free exist as commands', () => {
  for (const f of ['moderation/case', 'moderation/warn', 'moderation/tempban', 'moderation/appeal', 'leveling/levelrole',
    'config/logging', 'config/ticket', 'music/play', 'lastfm/fm', 'config/reactionrole', 'utility/tag',
    'moderation/reportvc', 'config/antinuke', 'config/voicemaster', 'config/scamshield']) {
    assert.ok(fs.existsSync(path.join(root, 'src', 'commands', `${f}.js`)), f);
  }
  const fm = fs.readFileSync(path.join(root, 'src', 'commands', 'lastfm', 'fm.js'), 'utf8');
  assert.match(fm, /setName\('whoknows'\)/);
  assert.match(fm, /setName\('crowns'\)/);
});

test('no price or checkout for mofu', () => {
  assert.doesNotMatch(page, /[₹€£]|\bRs\.?\s?\d|\bINR\b/);
  // the only dollar amounts on the page are Greed's published prices
  const dollars = page.match(/\$\d[\d.,]*/g) || [];
  assert.deepStrictEqual([...new Set(dollars)].sort(), ['$5.99', '$59.99', '$69.99']);
  assert.doesNotMatch(page, /checkout|stripe|paypal|subscribe|waitlist\s*form/i);
  assert.doesNotMatch(page, /sonder\.gg/i);
});
