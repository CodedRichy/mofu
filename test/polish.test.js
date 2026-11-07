const test = require('node:test');
const assert = require('node:assert');
const { Collection } = require('discord.js');
const presence = require('../src/utils/presence');
const actions = require('../src/ai/actions');

const { canPress } = actions.shared;

test('presence: members without presence data are "status unavailable", never offline', () => {
  assert.strictEqual(presence.statusOf({ presence: null }), null);
  assert.strictEqual(presence.statusOf(undefined), null);
  assert.strictEqual(presence.statusText({ presence: undefined }), 'status unavailable');
  assert.strictEqual(presence.statusText({ presence: { status: 'idle' } }), 'idle');
  assert.strictEqual(presence.hasPresence({ presence: { status: 'offline' } }), true);
});

test('presence: online count is null when nobody carries presence, a real count otherwise', () => {
  const none = new Collection([['1', { presence: null }], ['2', {}]]);
  assert.strictEqual(presence.onlineCount(none), null);
  const some = new Collection([['1', { presence: { status: 'online' } }], ['2', { presence: { status: 'offline' } }], ['3', {}]]);
  assert.strictEqual(presence.onlineCount(some), 1);
});

function press(userId, guildMembers) {
  return {
    user: { id: userId },
    guild: { members: { fetch: async ({ user }) => { const m = guildMembers[user]; if (!m) throw new Error('unknown'); return m; } } },
  };
}
const has = (...flags) => ({ permissions: { has: (f) => flags.includes(f) } });

test('canPress: requester-only card rejects everyone else, even a moderator', async () => {
  const p = { invokerId: 'a' };
  assert.strictEqual((await canPress(p, press('a', {}))).ok, true);
  const r = await canPress(p, press('b', { b: has('ModerateMembers', 'MoveMembers') }));
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /only <@a>/);
});

test('canPress: anyoneWithPerm lets a member with that permission press, reading it fresh', async () => {
  const p = { invokerId: 'owner', anyoneWithPerm: 'MoveMembers' };
  assert.strictEqual((await canPress(p, press('mod', { mod: has('MoveMembers') }))).ok, true);
  assert.strictEqual((await canPress(p, press('owner', {}))).ok, true);
  const no = await canPress(p, press('rando', { rando: has('SendMessages') }));
  assert.strictEqual(no.ok, false);
  assert.match(no.message, /Move Members/);
  assert.strictEqual((await canPress(p, press('ghost', {}))).ok, false); // fetch fails: refuse
});

test('canPress: an unknown permission name never opens the card', async () => {
  const p = { invokerId: 'owner', anyoneWithPerm: 'NotAPermission' };
  assert.strictEqual((await canPress(p, press('mod', { mod: has('NotAPermission') }))).ok, false);
});

test('moderation commands open a numbered case and pass it to the reply and modlog', () => {
  const fs = require('fs');
  for (const f of ['jail', 'hardmute', 'imute', 'rmute', 'softban']) {
    const src = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'commands', 'moderation', `${f}.js`), 'utf8');
    assert.match(src, /modlog\.openCase\(/, `${f} opens a case`);
    assert.match(src, /caseId/, `${f} uses the case id`);
    assert.match(src, /modlog\.send\([^)]*caseId/s, `${f} passes caseId to the modlog`);
  }
});
