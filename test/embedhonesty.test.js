// Embed honesty guard (see logs/embed-audit.md): user-facing text may only claim what the code does.
// Static scan of string literals on lines that build a message (description, title, footer, reply, send, ...)
// in src/{commands,events,ai,music,utils}. Three checks:
//   1. overclaiming words ("instantly", "guaranteed", "always", "kept alive", ...)
//   2. a number with a time unit written into the text instead of computed from the constant it describes
//   3. a `/name` reference to a command that is prefix-only (PREFIX_ONLY) or does not exist
// A line that is genuinely true can opt out with a same-line `// claim-ok: <why>`. Keep those rare.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const DIRS = ['commands', 'events', 'ai', 'music', 'utils'].map((d) => path.join(SRC, d));

// Lines that put text in front of members.
const SINK = /description:|setDescription\(|setTitle\(|setFooter\(|setAuthor\(|content:|value:|reply\(|send\(|footer\(/;
const BANNED = /\b(guarantee[ds]?|instant(ly)?|always|never|perfect(ly)?|best|secure(ly)?|bulletproof|seamless(ly)?|effortless(ly)?|blazing|lightning|unbreakable|fully|completely|ultimate|shortly|kept alive|stopped)\b|100%|sonder\.gg/i;
const NUM_UNIT = /\b\d+\s*(ms|s|secs?|seconds?|mins?|minutes?|h|hours?|d|days?)\b/;
const SLASH_REF = /`\/([a-z0-9_-]+)/g;

// Whole-line skips, each with a reason. Keep short.
const AI_PROMPT = /role:\s*'(system|user|assistant)'/; // AI prompts (this line or the one above): text for the model

// Lines where a number+unit is input syntax or a choice label backed by its value, not a claim.
const NUM_OK_LINE = [
  /\.add\w+Option\(/, // option descriptions show input formats ("30m, 1h, 1d", "24h format")
  /\bname:\s*['`][^'`]*['`],\s*value:/, // { name: '1 day', value: 86400000 }: the value is the source of truth
];
// Inside the text: `1h` code spans and "e.g. ..." examples are formats, not claims.
const stripExamples = (t) => t.replace(/`[^`]*`/g, ' ').replace(/e\.g\.[^)]*/gi, ' ');

// Commands that are not Sonder's (other bots), so `/name` is correct for them.
const EXTERNAL_SLASH = new Set([
  'bump', // Disboard's /bump, shown in the bump reminder
]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// Drop a trailing `// comment` (only when it follows code punctuation, so 'https://' in strings survives).
function stripComment(line) {
  return line.replace(/([;,)\]}{])\s*\/\/.*$/, '$1');
}

// Remove ${...} (one level of nested braces) so computed values are not scanned as text.
function stripInterpolation(s) {
  return s.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, ' ');
}

// String literal bodies on one line: '...', "...", `...` (single-line part only).
function literals(line) {
  const out = [];
  const re = /'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`((?:\\.|\$\{(?:[^{}]|\{[^{}]*\})*\}|[^`\\])*)`?/g;
  let m;
  while ((m = re.exec(line))) {
    if (m[1] !== undefined) out.push(m[1]);
    else if (m[2] !== undefined) out.push(m[2]);
    else if (m[3] !== undefined) out.push(m[3]);
  }
  return out;
}

// Regex literals like /`/g would read as a template start; blank out obvious regex literals first.
function stripRegexLiterals(line) {
  return line.replace(/(^|[(,=:!&|?{};\s])\/(?![/*])((?:\\.|\[(?:\\.|[^\]])*\]|[^/\\\n[])+)\/[gimsuy]*/g, '$1/re/');
}

function knownCommands() {
  const names = new Set();
  for (const f of walk(path.join(SRC, 'commands'))) {
    const m = fs.readFileSync(f, 'utf8').match(/new SlashCommandBuilder\(\)\s*\.setName\('([^']+)'\)/);
    if (m) names.add(m[1]);
  }
  return names;
}

function prefixOnly() {
  const src = fs.readFileSync(path.join(SRC, 'handlers', 'commandHandler.js'), 'utf8');
  const block = src.match(/const PREFIX_ONLY = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(block, 'PREFIX_ONLY block not found in commandHandler.js');
  const body = block[1].split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  return new Set([...body.matchAll(/'([^']+)'/g)].map((m) => m[1]));
}

function scan() {
  const commands = knownCommands();
  const prefix = prefixOnly();
  const problems = [];
  for (const file of DIRS.flatMap((d) => walk(d))) {
    const rel = path.relative(path.join(__dirname, '..'), file).replace(/\\/g, '/');
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((raw, i) => {
      if (/\/\/\s*claim-ok:/.test(raw)) return;
      const trimmed = raw.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      if (AI_PROMPT.test(raw) || (i > 0 && AI_PROMPT.test(lines[i - 1]))) return;
      const line = stripRegexLiterals(stripComment(raw));
      if (!SINK.test(line)) return;
      const numOk = NUM_OK_LINE.some((re) => re.test(line));
      for (const lit of literals(line)) {
        const text = stripInterpolation(lit);
        const where = `${rel}:${i + 1}`;
        const word = text.match(BANNED);
        if (word) problems.push(`${where} overclaiming word "${word[0]}"`);
        const num = numOk ? null : stripExamples(text).match(NUM_UNIT);
        if (num) problems.push(`${where} hard-coded "${num[0]}" (compute it from the constant)`);
        for (const m of text.matchAll(SLASH_REF)) {
          const name = m[1];
          if (EXTERNAL_SLASH.has(name)) continue;
          if (!commands.has(name)) problems.push(`${where} \`/${name}\` is not a command`);
          else if (prefix.has(name)) problems.push(`${where} \`/${name}\` is prefix-only (use cmdRef from src/utils/invocation.js)`);
        }
      }
    });
  }
  return problems;
}

test('user-facing strings make no claims the code does not back', () => {
  const problems = scan();
  assert.deepStrictEqual(problems, [], `\n${problems.join('\n')}\n`);
});

test('the honesty scanner catches what it should (self-check)', () => {
  const lits = (l) => literals(stripRegexLiterals(stripComment(l))).map(stripInterpolation);
  assert.match(lits("reply({ content: 'Done instantly!' })")[0], BANNED);
  assert.match(lits('setDescription(`muted for 1 minute`)')[0], NUM_UNIT);
  assert.doesNotMatch(lits('setDescription(`muted for ${n} minutes`)')[0], NUM_UNIT);
  assert.deepStrictEqual(lits("x.replace(/`/g, \"'\"); send('ok')").filter((s) => s.includes('`')), []);
  assert.ok(prefixOnly().size > 0);
  assert.ok(knownCommands().has('help'));
});
