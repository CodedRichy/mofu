// Brand guard: the bot is called "mofu" (always lowercase). The old name "sonder" may only survive where it is
// internal and renaming it would break something (database file, cookie and storage keys, env vars, backup
// file names) or where the bot still answers to it in chat (TRIGGER_WORDS in src/utils/constants.js).
//
// Scans every line of code in src/**/*.js. Comments are skipped (they are not shown to anyone). Unlike the
// embed honesty scan this does not stop at "sink" lines: role/channel audit reasons, AI prompts in multi-line
// template literals and channel names reach users too, so any code line naming the old brand fails unless it
// is in INTERNAL below or carries a same-line `// brand-ok: <why>` marker. Keep both rare.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const OLD = /sonder/i;

// Internal names, each with the reason it stays. Matched against the code part of a line.
const INTERNAL = [
  [/'sonder\.db'/, 'database file data/sonder.db: renaming loses every server\'s data'],
  [/process\.env\.SONDER_XP_DB/, 'env var name used by deployments and tests'],
  [/'sonder-dev-secret'/, 'dev-only fallback secret; changing it logs out dev sessions'],
  [/'sonder_oauth'/, 'OAuth state cookie name; renaming breaks logins in flight'],
  [/'sonder-oauth-state-v1'/, 'HMAC label for OAuth state; renaming invalidates state in flight'],
  [/\^sonder-\(\\d\{8\}\)-\(\\d\{4\}\)\\\.db\$|`sonder-\$\{stamp\(now\)\}\.db`/, 'backup file names; rotation must keep finding old backups'],
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// Drop a trailing `// comment` (only when it follows code punctuation, so 'https://' in strings survives).
const stripComment = (line) => line.replace(/([;,)\]}{])\s*\/\/.*$/, '$1');
const isCommentLine = (t) => t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');

// Returns problems for one file's text.
function scanText(rel, text) {
  const problems = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (!OLD.test(raw)) return;
    if (/\/\/\s*brand-ok:\s*\S/.test(raw)) return;
    if (isCommentLine(raw.trim())) return;
    let code = stripComment(raw);
    for (const [re] of INTERNAL) code = code.replace(re, ' ');
    if (OLD.test(code)) problems.push(`${rel}:${i + 1} names the old brand: ${raw.trim().slice(0, 140)}`);
  });
  return problems;
}

function scan() {
  const problems = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(path.join(__dirname, '..'), file).replace(/\\/g, '/');
    problems.push(...scanText(rel, fs.readFileSync(file, 'utf8')));
  }
  return problems;
}

test('no user-facing text in src/ uses the old brand', () => {
  const problems = scan();
  assert.deepStrictEqual(problems, [], `\n${problems.join('\n')}\n`);
});

test('the dashboard page shows the new brand (only its storage key keeps the old name)', () => {
  const html = fs.readFileSync(path.join(SRC, 'dashboard', 'public', 'index.html'), 'utf8');
  assert.doesNotMatch(html.replace(/'sonder_token'/g, ''), OLD);
  assert.match(html, /<title>mofu/);
});

test('brand constants: lowercase name, both trigger words', () => {
  const { BRAND, TRIGGER_WORDS, TRIGGER_ALT, LOG_CHANNEL, channelNames } = require('../src/utils/constants');
  assert.strictEqual(BRAND, 'mofu');
  assert.strictEqual(BRAND, BRAND.toLowerCase());
  assert.deepStrictEqual([...TRIGGER_WORDS], ['mofu', 'sonder']);
  assert.ok(TRIGGER_WORDS.every((w) => /^[a-z]+$/.test(w)), 'trigger words go into regexes unescaped');
  assert.strictEqual(TRIGGER_ALT, 'mofu|sonder');
  assert.strictEqual(LOG_CHANNEL, 'mofu-logs');
  assert.deepStrictEqual(channelNames('mofu-logs'), ['mofu-logs', 'sonder-logs']);
  assert.deepStrictEqual(channelNames('modlog'), ['modlog']);
});

test('embed footers carry the new brand', () => {
  const { base, footer, errorCard } = require('../src/utils/embed');
  assert.strictEqual(base(null).data.footer.text, 'mofu');
  assert.strictEqual(footer(null, 'page 1').text, 'page 1 - mofu');
  assert.strictEqual(footer(null, '').text, 'mofu');
  assert.strictEqual(errorCard({ client: null, title: 't', fix: 'f', ref: 'abc' }).data.footer.text, 'ref abc - mofu');
});

test('the brand scanner catches what it should (self-check)', () => {
  assert.strictEqual(scanText('x.js', "reply({ content: 'Thanks for adding Sonder' });").length, 1);
  assert.strictEqual(scanText('x.js', "  reason: '[sonder] Auto-created jail role',").length, 1);
  // a line in the middle of a multi-line template literal (an AI prompt) still counts
  assert.strictEqual(scanText('x.js', "you're sonder, a bot that hangs out here.").length, 1);
  assert.strictEqual(scanText('x.js', '// yo sonder, mute x').length, 0);
  assert.strictEqual(scanText('x.js', "const x = 1; // the old sonder name").length, 0);
  assert.strictEqual(scanText('x.js', "const a = ['sonder-logs']; // brand-ok: legacy channel").length, 0);
  assert.strictEqual(scanText('x.js', "const a = ['sonder-logs']; // brand-ok:").length, 1, 'a marker needs a reason');
  assert.strictEqual(scanText('x.js', "const dbPath = path.join(__dirname, 'data', 'sonder.db');").length, 0);
  assert.strictEqual(scanText('x.js', "send('sonder.db is our file, sonder rocks');").length, 1);
});
