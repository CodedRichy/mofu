const test = require('node:test');
const assert = require('node:assert');
const { SlashCommandBuilder } = require('discord.js');
const PrefixContext = require('../src/utils/prefixContext');

const command = {
  data: new SlashCommandBuilder()
    .setName('demo').setDescription('demo')
    .addIntegerOption((o) => o.setName('amount').setDescription('n').setMinValue(1).setMaxValue(100).setRequired(true))
    .addStringOption((o) => o.setName('mode').setDescription('m').addChoices({ name: 'Fast', value: 'fast' }, { name: 'Slow', value: 'slow' }))
    .addStringOption((o) => o.setName('note').setDescription('t').setMaxLength(10)),
};
const fakeMessage = { author: { id: '1' }, member: {}, channel: {}, client: {}, guild: {}, guildId: 'g', channelId: 'c', createdTimestamp: 0, attachments: new Map() };
const ctxFor = (args) => new PrefixContext(fakeMessage, args, command);

test('valid input passes untouched', () => {
  const c = ctxFor(['10', 'fast']);
  assert.deepStrictEqual(c._invalid, []);
  assert.strictEqual(c.options.getInteger('amount'), 10);
});

test('out-of-range numbers are rejected', () => {
  assert.match(ctxFor(['500'])._invalid[0], /at most 100/);
  assert.match(ctxFor(['0'])._invalid[0], /at least 1/);
  assert.match(ctxFor(['-5'])._invalid[0], /at least 1/);
});

test('non-numeric input is rejected, not silently null', () => {
  assert.match(ctxFor(['all'])._invalid[0], /must be a number/);
});

test('bad choice is rejected, wrong-case choice is normalized', () => {
  assert.match(ctxFor(['5', 'turbo'])._invalid[0], /must be one of/);
  const c = ctxFor(['5', 'FAST']);
  assert.deepStrictEqual(c._invalid, []);
  assert.strictEqual(c.options.getString('mode'), 'fast');
});

test('string length limit is enforced', () => {
  assert.match(ctxFor(['5', 'fast', 'this note is far too long'])._invalid[0], /at most 10 characters/);
});

test('sloppy numbers are rejected, not truncated', () => {
  for (const bad of ['1k', '1,000', '5e3', '1_0', '12abc', '1.5']) {
    assert.match(ctxFor([bad])._invalid[0], /must be a number/, bad);
  }
  assert.strictEqual(ctxFor(['+7']).options.getInteger('amount'), 7);
});

const userCmd = { data: new SlashCommandBuilder().setName('u').setDescription('u').addUserOption((o) => o.setName('target').setDescription('t')) };
const msgWith = (cached) => ({ ...fakeMessage, client: { users: { cache: new Map(cached.map((i) => [i, { id: i }])) } } });

test('unresolved user ids are invalid, resolved ones pass', () => {
  const id = '123456789012345678';
  assert.match(new PrefixContext(msgWith([]), [id], userCmd)._invalid[0], /Could not find that user/);
  assert.match(new PrefixContext(msgWith([]), ['garbage'], userCmd)._invalid[0], /Could not find that user/);
  const ok = new PrefixContext(msgWith([id]), [`<@${id}>`], userCmd);
  assert.deepStrictEqual(ok._invalid, []);
  assert.strictEqual(ok.options.getUser('target').id, id);
});
