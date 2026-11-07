const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Static guard: every config key the setup-style commands write must have a
// reader somewhere else in src/, otherwise the command reports "Enabled" while
// nothing changes (e.g. `wordfilter` vs `word_filter`).

const SRC = path.join(__dirname, '..', 'src');
const CONFIG_DIR = path.join(SRC, 'commands', 'config');
const WRITERS = ['setup.js', 'quicksetup.js', 'logging.js', 'rolesetup.js'].map((f) => path.join(CONFIG_DIR, f));
// configaudit only inspects values; it does not count as a real consumer.
const NOT_READERS = new Set([...WRITERS, path.join(CONFIG_DIR, 'configaudit.js')]);

// Keys written on purpose that have no runtime reader. Keep this empty if possible.
const ALLOWLIST = new Set([
  // (none)
]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

function literalKeys(src, fn) {
  const re = new RegExp(`${fn}\\(\\s*[^,()]+,\\s*'([^']+)'`, 'g');
  return [...src.matchAll(re)].map((m) => m[1]);
}

// Keys a writer file stores: direct setConfig literals plus the data tables the
// wizard/templates iterate over and pass to setConfig.
function writtenKeys(src) {
  const keys = new Set(literalKeys(src, 'setConfig'));
  for (const m of src.matchAll(/\bkey:\s*'([a-z_]+)'/g)) keys.add(m[1]); // setup.js toggles
  for (const m of src.matchAll(/\bvalue:\s*'(log_[a-z_]+)'/g)) keys.add(m[1]); // logging.js choices
  for (const m of src.matchAll(/:\s*'([a-z]+_channel)'/g)) keys.add(m[1]); // quicksetup channelKeyMap
  for (const m of src.matchAll(/config:\s*\{([^}]*)\}/g)) {
    for (const k of m[1].matchAll(/\b([a-z_]+):/g)) keys.add(k[1]); // quicksetup template config
  }
  return keys;
}

const files = walk(SRC);
const readKeys = new Set();
for (const f of files) {
  if (NOT_READERS.has(f)) continue;
  for (const k of literalKeys(fs.readFileSync(f, 'utf8'), 'getConfig')) readKeys.add(k);
}

for (const file of WRITERS) {
  test(`${path.basename(file)}: every written config key has a reader`, () => {
    const keys = writtenKeys(fs.readFileSync(file, 'utf8'));
    if (!file.endsWith('rolesetup.js')) assert.ok(keys.size > 0, 'expected to find written keys');
    const orphans = [...keys].filter((k) => !readKeys.has(k) && !ALLOWLIST.has(k));
    assert.deepStrictEqual(orphans, [], `written but never read: ${orphans.join(', ')}`);
  });
}

test('known-bad key names are gone from the setup commands', () => {
  const bad = ['wordfilter', 'leveling_enabled', 'tickets_enabled', 'starboard_enabled', 'counter_enabled', 'audit_channel', 'jail_role'];
  for (const file of [...WRITERS, path.join(CONFIG_DIR, 'configaudit.js')]) {
    const src = fs.readFileSync(file, 'utf8');
    for (const k of bad) assert.ok(!new RegExp(`'${k}'`).test(src), `${path.basename(file)} still uses '${k}'`);
  }
});
