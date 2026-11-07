const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../src/database/store');
const gambling = require('../src/utils/gambling');
const { decideClaim, denyText } = require('../src/handlers/ticket');

const G = 'test-guild-gambling';
test.after(() => store.setConfig(G, 'gambling_enabled', null));

function fakeInteraction() {
  const sent = [];
  return { sent, guild: { id: G }, client: { user: { displayAvatarURL: () => '', username: 'm' } }, reply: async (p) => { sent.push(p); } };
}

test('gambling is off by default and blocks with the exact message, ephemeral', async () => {
  store.setConfig(G, 'gambling_enabled', null);
  const i = fakeInteraction();
  assert.strictEqual(await gambling.blocked(i), true);
  assert.strictEqual(i.sent[0].ephemeral, true);
  assert.strictEqual(gambling.OFF_MESSAGE, 'Games with currency bets are off in this server. An admin can turn them on with /gambling enable');
  assert.ok(i.sent[0].embeds[0].data.description.includes(gambling.OFF_MESSAGE));
});

test('enabled server is not blocked; only true enables', async () => {
  store.setConfig(G, 'gambling_enabled', 'yes');
  assert.strictEqual(await gambling.blocked(fakeInteraction()), true);
  store.setConfig(G, 'gambling_enabled', true);
  const i = fakeInteraction();
  assert.strictEqual(await gambling.blocked(i), false);
  assert.strictEqual(i.sent.length, 0);
  store.setConfig(G, 'gambling_enabled', false);
  assert.strictEqual(gambling.isEnabled(G), false);
});

test('the five bet games call the gate first; basic economy does not', () => {
  const dir = path.join(__dirname, '..', 'src', 'commands', 'economy');
  for (const f of ['blackjack', 'slots', 'coinflip', 'heist', 'rob']) {
    const src = fs.readFileSync(path.join(dir, `${f}.js`), 'utf8');
    const after = src.slice(src.indexOf('async execute(interaction) {'));
    assert.ok(after.split('\n')[1].includes('gambling.blocked(interaction)'), `${f} must gate on the first line`);
  }
  for (const f of ['daily', 'work', 'bank', 'shop', 'transfer']) {
    assert.ok(!fs.readFileSync(path.join(dir, `${f}.js`), 'utf8').includes('gambling'), f);
  }
});

test('/gambling command shape', () => {
  const cmd = require('../src/commands/config/gambling');
  assert.strictEqual(cmd.data.name, 'gambling');
  assert.deepStrictEqual(cmd.data.toJSON().options.map((o) => o.name), ['enable', 'disable', 'status']);
});

test('ticket claim: staff only, one claimer, second claim names the first', () => {
  const base = { supportRoleId: 'sup', memberRoleIds: ['sup'], userId: 'a' };
  assert.deepStrictEqual(decideClaim(base), { ok: true });
  assert.strictEqual(decideClaim({ ...base, memberRoleIds: [] }).reason, 'not_staff');
  assert.strictEqual(decideClaim({ ...base, memberRoleIds: [], canManageChannels: true }).reason, 'not_staff'); // role set: role required
  assert.strictEqual(decideClaim({ userId: 'a', canManageChannels: true }).ok, true); // no role set: Manage Channels
  assert.strictEqual(decideClaim({ userId: 'a' }).reason, 'not_staff');
  const second = decideClaim({ ...base, userId: 'b', memberRoleIds: ['sup'], claimedBy: 'a' });
  assert.strictEqual(second.reason, 'claimed');
  assert.match(denyText(second), /<@a>/);
  assert.strictEqual(decideClaim({ ...base, claimedBy: 'a' }).reason, 'already_yours');
});
