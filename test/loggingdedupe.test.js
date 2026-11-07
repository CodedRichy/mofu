const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../src/database/store');
const logevents = require('../src/utils/logevents');

const EVENTS_DIR = path.join(__dirname, '..', 'src', 'events');
const G = 'test-guild-logevents';
test.after(() => { for (const k of [...logevents.KEYS, 'log_channel', 'logging_channel']) store.setConfig(G, k, null); });

function handlersFor(name) {
  const out = [];
  for (const f of fs.readdirSync(EVENTS_DIR).filter((x) => x.endsWith('.js'))) {
    const mod = require(path.join(EVENTS_DIR, f));
    for (const e of (Array.isArray(mod) ? mod : [mod])) if (e.name === name) out.push(f);
  }
  return out;
}

test('exactly one handler logs message delete and message edit', () => {
  assert.deepStrictEqual(handlersFor('messageDelete'), ['messageDelete.js']);
  assert.deepStrictEqual(handlersFor('messageUpdate'), ['messageUpdate.js']);
});

const guild = (channels) => ({ id: G, channels: { cache: new Map(Object.entries(channels)) } });

test('resolve returns the channel, honours either channel key, and respects toggles', () => {
  const g = guild({ c1: { id: 'c1' } });
  assert.strictEqual(logevents.resolve(g, 'log_message_delete'), null); // no channel set
  store.setConfig(G, 'logging_channel', 'c1');
  assert.strictEqual(logevents.resolve(g, 'log_message_delete').id, 'c1');
  store.setConfig(G, 'log_message_delete', false);
  assert.strictEqual(logevents.resolve(g, 'log_message_delete'), null);
  assert.strictEqual(logevents.resolve(g, 'log_message_edit').id, 'c1'); // other types unaffected
  store.setConfig(G, 'log_message_delete', true);
  assert.ok(logevents.resolve(g, 'log_message_delete'));
});

test('every logger reads its toggle through logevents (no raw log_* reads)', () => {
  for (const f of ['auditLog.js', 'messageDelete.js', 'messageUpdate.js']) {
    const src = fs.readFileSync(path.join(EVENTS_DIR, f), 'utf8');
    assert.ok(src.includes('logevents'), f);
    assert.ok(!/getConfig\([^)]*'log(ging)?_channel'/.test(src), `${f} reads the channel directly`);
  }
});

test('state lines list every event in the table, reflect toggles, and say what is not logged', () => {
  store.setConfig(G, 'log_nickname', false);
  const lines = logevents.stateLines(G);
  assert.strictEqual(lines.length, logevents.EVENTS.length);
  assert.ok(lines.some((l) => l.startsWith('Off') && l.includes('Nickname')));
  assert.ok(lines.some((l) => l.startsWith('On') && l.includes('role changes')));
  assert.match(logevents.NOT_LOGGED, /join/i);
  store.setConfig(G, 'log_nickname', null);
});

test('toggle choices come from the table (<= 25) and keys are unique', () => {
  assert.ok(logevents.EVENTS.length <= 25);
  assert.strictEqual(new Set(logevents.KEYS).size, logevents.KEYS.length);
});
