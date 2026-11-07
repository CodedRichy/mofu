const test = require('node:test');
const assert = require('node:assert');
const { PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const invite = require('../src/commands/utility/invite');
const { detectMentionTrigger, mentionsBotAnywhere } = require('../src/utils/mentionTrigger');

const BOT = '123456789012345678';

test('invite permissions never include Administrator', () => {
  const bits = invite.permissionBits();
  assert.equal(bits.has(PermissionFlagsBits.Administrator), false);
  assert.equal(invite.PERMISSIONS.some(([n]) => n === 'Administrator'), false);
  assert.equal(bits.bitfield & PermissionFlagsBits.Administrator, 0n);
});

test('every requested permission is a real flag with a reason, no duplicates', () => {
  const names = invite.PERMISSIONS.map(([n]) => n);
  assert.equal(new Set(names).size, names.length);
  for (const [name, why] of invite.PERMISSIONS) {
    assert.ok(PermissionFlagsBits[name] !== undefined, `unknown flag ${name}`);
    assert.ok(why && why.length > 3, `${name} needs a reason`);
  }
});

test('broad permissions stay out of the requested set', () => {
  const names = new Set(invite.PERMISSIONS.map(([n]) => n));
  for (const n of ['Administrator', 'ManageGuild', 'ManageWebhooks', 'MentionEveryone', 'ManageGuildExpressions']) {
    assert.equal(names.has(n), false, n);
  }
});

test('invite url carries client id, scopes and the exact bitfield', () => {
  const url = new URL(invite.buildInviteUrl(BOT));
  assert.equal(url.origin + url.pathname, 'https://discord.com/oauth2/authorize');
  assert.equal(url.searchParams.get('client_id'), BOT);
  assert.deepEqual(url.searchParams.get('scope').split(' '), ['bot', 'applications.commands']);
  const bits = BigInt(url.searchParams.get('permissions'));
  assert.equal(bits, invite.permissionBits().bitfield);
  assert.equal(new PermissionsBitField(bits).has(PermissionFlagsBits.Administrator), false);
});

test('invite url rejects a missing client id', () => {
  assert.equal(invite.buildInviteUrl(''), null);
  assert.equal(invite.buildInviteUrl(undefined), null);
});

test('execute replies with the link and names every permission', async () => {
  let sent;
  await invite.execute({ client: { user: { id: BOT, displayAvatarURL: () => null } }, reply: async (p) => { sent = p; } });
  const text = sent.embeds[0].data.description;
  assert.ok(text.includes('discord.com/oauth2/authorize'));
  for (const [name] of invite.PERMISSIONS) assert.ok(text.includes(name), name);
});

test('mention at the start triggers and is stripped', () => {
  assert.deepEqual(detectMentionTrigger({ content: `<@${BOT}> what time is it`, botId: BOT }), { triggered: true, kind: 'mention', text: 'what time is it' });
  assert.equal(detectMentionTrigger({ content: `<@!${BOT}>, hi`, botId: BOT }).text, 'hi');
  assert.equal(detectMentionTrigger({ content: `  <@${BOT}>`, botId: BOT }).text, '');
});

test('mention in the middle or of someone else does not trigger', () => {
  assert.equal(detectMentionTrigger({ content: `hey <@${BOT}> you there`, botId: BOT }).triggered, false);
  assert.equal(detectMentionTrigger({ content: '<@999999999999999999> hi', botId: BOT }).triggered, false);
  assert.equal(detectMentionTrigger({ content: `<@${BOT}0> hi`, botId: BOT }).triggered, false);
});

test('reply to the bot triggers and keeps the text', () => {
  assert.deepEqual(detectMentionTrigger({ content: ' thanks! ', botId: BOT, isReplyToBot: true }), { triggered: true, kind: 'reply', text: 'thanks!' });
  assert.equal(detectMentionTrigger({ content: `<@${BOT}> and one more thing`, botId: BOT, isReplyToBot: true }).text, 'and one more thing');
});

test('bad input is safe', () => {
  assert.equal(detectMentionTrigger().triggered, false);
  assert.equal(detectMentionTrigger({ content: null, botId: BOT }).triggered, false);
  assert.equal(detectMentionTrigger({ content: 'hi', botId: '' }).triggered, false);
  assert.equal(mentionsBotAnywhere(`x <@${BOT}> y`, BOT), true);
  assert.equal(mentionsBotAnywhere('x', BOT), false);
});
