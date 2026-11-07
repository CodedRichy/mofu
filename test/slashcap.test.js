const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ApplicationCommandOptionType: T } = require('discord.js');

// Never open data/sonder.db: every src/database module is replaced with an inert stub before any command loads.
const dbDir = path.join(__dirname, '..', 'src', 'database');
const inert = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : inert), apply: () => undefined });
for (const f of fs.readdirSync(dbDir).filter((x) => x.endsWith('.js'))) {
  const p = path.join(dbDir, f);
  require.cache[p] = { id: p, filename: p, loaded: true, exports: inert };
}

const { PREFIX_ONLY } = require('../src/handlers/commandHandler');

const DISCORD_SLASH_CAP = 100;
const NAME_RE = /^[-_\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;

function loadAll() {
  const root = path.join(__dirname, '..', 'src', 'commands');
  const out = [];
  for (const cat of fs.readdirSync(root)) {
    const dir = path.join(root, cat);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
      const cmd = require(path.join(dir, file));
      out.push({ where: `${cat}/${file}`, cmd });
    }
  }
  return out;
}

// Returns a list of human-readable rule violations for one command's JSON payload.
function violations(json) {
  const errs = [];
  let chars = 0;
  const checkName = (n, where) => {
    if (typeof n !== 'string' || !NAME_RE.test(n) || n !== n.toLowerCase()) errs.push(`${where}: bad name "${n}"`);
    chars += String(n || '').length;
  };
  const checkDesc = (d, where) => {
    if (typeof d !== 'string' || d.length < 1 || d.length > 100) errs.push(`${where}: description length ${d?.length}`);
    chars += String(d || '').length;
  };

  function checkOptions(opts, where, level) {
    if (!opts) return;
    if (opts.length > 25) errs.push(`${where}: ${opts.length} options (max 25)`);
    const names = new Set();
    let sawOptional = false;
    const isSub = (o) => o.type === T.Subcommand || o.type === T.SubcommandGroup;
    const subs = opts.filter(isSub).length;
    if (subs && subs !== opts.length) errs.push(`${where}: mixes subcommands with plain options`);
    for (const o of opts) {
      const w = `${where}.${o.name}`;
      checkName(o.name, w);
      checkDesc(o.description, w);
      if (names.has(o.name)) errs.push(`${w}: duplicate option name`);
      names.add(o.name);
      if (o.type === T.SubcommandGroup) {
        if (level !== 0) errs.push(`${w}: subcommand group nested too deep`);
        if (!(o.options || []).every((s) => s.type === T.Subcommand)) errs.push(`${w}: group may only hold subcommands`);
        checkOptions(o.options, w, level + 1);
        continue;
      }
      if (o.type === T.Subcommand) {
        if (level > 1) errs.push(`${w}: subcommand nested too deep`);
        if ((o.options || []).some(isSub)) errs.push(`${w}: subcommand holds a subcommand`);
        checkOptions(o.options, w, 2);
        continue;
      }
      if (o.required) { if (sawOptional) errs.push(`${w}: required option after an optional one`); } else sawOptional = true;
      if (o.choices) {
        if (o.choices.length > 25) errs.push(`${w}: ${o.choices.length} choices (max 25)`);
        if (o.autocomplete) errs.push(`${w}: choices and autocomplete together`);
        for (const c of o.choices) {
          if (!c.name || c.name.length > 100) errs.push(`${w}: choice name length ${c.name?.length}`);
          if (typeof c.value === 'string' && (c.value.length < 1 || c.value.length > 100)) errs.push(`${w}: choice value length ${c.value.length}`);
          chars += String(c.name || '').length + String(c.value).length;
        }
      }
      if (o.min_length !== undefined && (o.min_length < 0 || o.min_length > 6000)) errs.push(`${w}: min_length ${o.min_length}`);
      if (o.max_length !== undefined && (o.max_length < 1 || o.max_length > 6000)) errs.push(`${w}: max_length ${o.max_length}`);
      if (o.min_length !== undefined && o.max_length !== undefined && o.min_length > o.max_length) errs.push(`${w}: min_length > max_length`);
      if (o.min_value !== undefined && o.max_value !== undefined && o.min_value > o.max_value) errs.push(`${w}: min_value > max_value`);
    }
  }

  checkName(json.name, json.name);
  checkDesc(json.description, json.name);
  checkOptions(json.options, json.name, 0);
  if (chars > 4000) errs.push(`${json.name}: ${chars} total characters (max 4000)`);
  return errs;
}

const all = loadAll();
const slash = all.filter(({ cmd }) => !PREFIX_ONLY.has(cmd.data.name));

test('every command exports data + execute and names are unique', () => {
  const seen = new Map();
  for (const { where, cmd } of all) {
    assert.ok(cmd.data && typeof cmd.execute === 'function', `${where}: missing data/execute`);
    const n = cmd.data.name;
    assert.ok(!seen.has(n), `${where}: duplicate command name "${n}" (also ${seen.get(n)})`);
    seen.set(n, where);
  }
});

test('PREFIX_ONLY lists only commands that exist', () => {
  const names = new Set(all.map(({ cmd }) => cmd.data.name));
  const stale = [...PREFIX_ONLY].filter((n) => !names.has(n));
  assert.deepStrictEqual(stale, []);
});

test(`slash command count stays within Discord's cap of ${DISCORD_SLASH_CAP}`, () => {
  assert.ok(slash.length <= DISCORD_SLASH_CAP, `${slash.length} slash commands registered (max ${DISCORD_SLASH_CAP})`);
});

test('every slash builder serializes within Discord limits', () => {
  const errs = [];
  for (const { where, cmd } of slash) {
    let json;
    try { json = cmd.data.toJSON(); } catch (err) { errs.push(`${where}: toJSON threw ${err.message}`); continue; }
    errs.push(...violations(json));
  }
  assert.deepStrictEqual(errs, []);
});

test('the validator catches the rules it claims to', () => {
  const bad = violations({
    name: 'Bad Name', description: '',
    options: [
      { type: T.String, name: 'a', description: 'x' },
      { type: T.String, name: 'b', description: 'x', required: true, choices: Array.from({ length: 26 }, (_, i) => ({ name: `c${i}`, value: `c${i}` })) },
      { type: T.Subcommand, name: 's', description: 'x' },
    ],
  });
  const text = bad.join('\n');
  for (const needle of ['bad name', 'description length', 'required option after', '26 choices', 'mixes subcommands']) {
    assert.ok(text.includes(needle), `validator missed: ${needle}`);
  }
});
