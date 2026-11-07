// Wires punishment presets (src/utils/presets.js) into /mute, /tempban and /warn add.
// Presets inform, they never restrict: a preset fills in the duration and reason the moderator left out, and when the
// moderator's own duration differs, one honest line says so. The action still goes through.
//
// Slash: the `preset` option is declared LAST on each command, after `reason`.
// Prefix: because the prefix parser makes only the last string option greedy, `reason` would get one word and
// `preset` the rest. readInputs() undoes that (reason + preset rejoined = the exact old reason text), so existing
// prefix usage parses as before. A preset is picked in prefix mode with a `preset:NAME` token anywhere after the user:
//   ;mute @x preset:spam            ;mute @x 2h preset:spam being loud            ;tempban @x preset:raid
const { parse, format } = require('./duration');
const presets = require('./presets');
const PrefixContext = require('./prefixContext');

const TOKEN_RE = /^preset:(\S+)$/i;

const isPrefix = (interaction) => interaction instanceof PrefixContext;

// Pure: pull a `preset:NAME` token out of the prefix words. durationWord is the one word the parser gave the
// duration option (null for /warn). Returns { duration, reason, presetName }.
function splitPrefixWords(durationWord, reasonText, { hasDuration = true } = {}) {
  let words = String(reasonText || '').split(/\s+/).filter(Boolean);
  let duration = durationWord || null;
  let presetName = null;
  const tokenAt = (w) => TOKEN_RE.exec(w || '');

  const inDur = hasDuration && tokenAt(duration);
  if (inDur) {
    presetName = inDur[1];
    duration = null;
    // ";mute @x preset:spam 2h ..." - the word after the token can still be the duration
    if (words.length && parse(words[0])) duration = words.shift();
  } else {
    const i = words.findIndex((w) => tokenAt(w));
    if (i >= 0) {
      presetName = tokenAt(words[i])[1];
      words = words.filter((_, j) => j !== i);
    }
  }
  return { duration, reason: words.length ? words.join(' ') : null, presetName };
}

// Read duration / reason / preset name from either a slash interaction or a prefix context.
function readInputs(interaction, { durationOption = 'duration' } = {}) {
  const o = interaction.options;
  const rawDur = durationOption ? o.getString(durationOption) : null;
  if (!isPrefix(interaction)) {
    return { duration: rawDur || null, reason: o.getString('reason') || null, presetName: o.getString('preset') || null };
  }
  const reasonText = [o.getString('reason'), o.getString('preset')].filter(Boolean).join(' ');
  const hasToken = TOKEN_RE.test(rawDur || '') || reasonText.split(/\s+/).some((w) => TOKEN_RE.test(w));
  if (!hasToken) return { duration: rawDur || null, reason: reasonText || null, presetName: null };
  return splitPrefixWords(rawDur, reasonText, { hasDuration: Boolean(durationOption) });
}

// Pure. action: the command's action ('mute' | 'tempban' | 'warn'). preset: the stored preset or null.
// duration: the moderator's duration text or null. maxMs: the command's own cap.
// Returns { error } or { durationMs, reason, note, presetName }. durationMs is the preset's (capped) when the
// moderator gave none, else null (the command parses and validates the moderator's own text as it always has).
function resolve({ action, presetName, preset, duration, reason, maxMs }) {
  const name = presetName ? String(presetName).trim().toLowerCase() : null;
  if (!name) return { durationMs: null, reason: reason || null, note: null, presetName: null };
  if (!preset) return { error: `No preset named \`${name.slice(0, 24)}\`. See the list with the \`preset list\` command.` };
  if (preset.action !== action) {
    return { error: `Preset \`${name}\` is a **${preset.action}** preset, not ${action}. Use it with the ${preset.action} command.` };
  }

  let durationMs = null;
  let note = null;
  if (!duration) {
    if (preset.durationMs) durationMs = maxMs ? Math.min(preset.durationMs, maxMs) : preset.durationMs;
  } else if (preset.durationMs) {
    const ms = parse(String(duration).trim());
    if (ms && !presets.checkConsistency(preset, { action, durationMs: ms }).consistent) note = differenceLine(name, preset);
  }
  return { durationMs, reason: reason || preset.reason || null, note, presetName: name };
}

function differenceLine(name, preset) {
  const dur = preset.durationMs ? ` ${format(preset.durationMs)}` : '';
  return `Differs from preset "${name}" (${preset.action}${dur})`;
}

// One call for the commands: read inputs, look the preset up, resolve. deps (tests): { getPreset }.
function fromInteraction(interaction, { action, maxMs, durationOption = 'duration' }, deps = {}) {
  const input = readInputs(interaction, { durationOption });
  const lookup = deps.getPreset || presets.getPreset;
  const preset = input.presetName ? lookup(interaction.guild.id, input.presetName) : null;
  const out = resolve({ action, presetName: input.presetName, preset, duration: input.duration, reason: input.reason, maxMs });
  return out.error ? out : { ...out, duration: input.duration };
}

// Autocomplete for the `preset` option: only this command's presets. deps (tests): { listPresets }.
async function autocomplete(interaction, action, deps = {}) {
  const list = deps.listPresets || presets.listPresets;
  const focused = String(interaction.options.getFocused() || '').toLowerCase();
  const table = list(interaction.guild.id);
  const choices = Object.keys(table).sort()
    .filter((n) => table[n].action === action && n.includes(focused))
    .slice(0, 25)
    .map((n) => ({ name: presets.describePreset(n, table[n]).replace(/`/g, '').slice(0, 100), value: n }));
  await interaction.respond(choices);
}

const joinExtra = (...parts) => parts.filter(Boolean).join('\n') || undefined;

module.exports = { TOKEN_RE, isPrefix, splitPrefixWords, readInputs, resolve, differenceLine, fromInteraction, autocomplete, joinExtra };
