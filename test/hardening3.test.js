'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { SlashCommandBuilder } = require('discord.js');
const PrefixContext = require('../src/utils/prefixContext');
const actions = require('../src/ai/actions');

const msg = { guild: { channels: { cache: new Map([['111111111111111111', {}]]) } }, client: { users: { cache: new Map() } }, author: { id: 'u' } };
const cmd = { data: new SlashCommandBuilder().setName('vc').setDescription('x')
  .addSubcommand((s) => s.setName('lockdown').setDescription('x')
    .addChannelOption((o) => o.setName('channel').setDescription('c').setRequired(true))
    .addBooleanOption((o) => o.setName('speak').setDescription('s'))
    .addStringOption((o) => o.setName('reason').setDescription('r'))) };
const ctx = (args) => new PrefixContext(msg, args, cmd);

test('prefix boolean does not eat the first reason word', () => {
  const c = ctx(['lockdown', '111111111111111111', 'raid', 'in', 'progress']);
  assert.strictEqual(c.options.getBoolean('speak'), null);
  assert.strictEqual(c.options.getString('reason'), 'raid in progress');
});

test('prefix boolean still accepts true/false/yes/no/on/off', () => {
  let c = ctx(['lockdown', '111111111111111111', 'true', 'raid']);
  assert.strictEqual(c.options.getBoolean('speak'), true);
  assert.strictEqual(c.options.getString('reason'), 'raid');
  c = ctx(['lockdown', '111111111111111111', 'off']);
  assert.strictEqual(c.options.getBoolean('speak'), false);
});

test('automated voice alerts do not block the owner AI cards', () => {
  const { pending, hasPending } = actions.shared;
  pending.set('t-alert', { guildId: 'gX', invokerId: 'owner', automated: true });
  assert.strictEqual(hasPending('gX', 'owner'), false);
  pending.set('t-card', { guildId: 'gX', invokerId: 'owner' });
  assert.strictEqual(hasPending('gX', 'owner'), true);
  pending.delete('t-alert'); pending.delete('t-card');
});
