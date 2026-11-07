const test = require('node:test');
const assert = require('node:assert');
const lv = require('../src/utils/xp');

const R = (n) => `1000000000000000${String(n).padStart(3, '0')}`; // fake 19-digit snowflakes

test('normalizeRewards keeps valid entries, one per role (lowest level), sorted', () => {
  const out = lv.normalizeRewards([
    { level: 10, role: R(2) },
    { level: 5, roleId: R(1) },
    { level: 3, role: R(2) }, // same role again at a lower level wins
    { level: -1, role: R(3) }, { level: 1.5, role: R(3) }, { level: 1e9, role: R(3) },
    { level: 4, role: 'abc' }, null, 'x', [],
  ]);
  assert.deepStrictEqual(out, [{ level: 3, role: R(2) }, { level: 5, role: R(1) }]);
  assert.deepStrictEqual(lv.normalizeRewards('junk'), []);
  assert.deepStrictEqual(lv.normalizeRewards(null), []);
});

test('selectRewardChanges: stack grants every earned reward and never removes', () => {
  const rewards = [{ level: 5, role: R(1) }, { level: 10, role: R(2) }, { level: 20, role: R(3) }];
  assert.deepStrictEqual(lv.selectRewardChanges(rewards, 12, new Set(), 'stack'), { add: [R(1), R(2)], remove: [] });
  assert.deepStrictEqual(lv.selectRewardChanges(rewards, 12, [R(1)], 'stack'), { add: [R(2)], remove: [] });
  assert.deepStrictEqual(lv.selectRewardChanges(rewards, 4, [R(3)], 'stack'), { add: [], remove: [] });
  // unknown mode falls back to stack
  assert.deepStrictEqual(lv.selectRewardChanges(rewards, 25, [], 'weird'), { add: [R(1), R(2), R(3)], remove: [] });
});

test('selectRewardChanges: replace keeps only the highest earned reward', () => {
  const rewards = [{ level: 5, role: R(1) }, { level: 10, role: R(2) }, { level: 10, role: R(4) }, { level: 20, role: R(3) }];
  assert.deepStrictEqual(lv.selectRewardChanges(rewards, 12, [R(1)], 'replace'), { add: [R(2), R(4)], remove: [R(1)] });
  // already correct: nothing to do
  assert.deepStrictEqual(lv.selectRewardChanges(rewards, 12, [R(2), R(4)], 'replace'), { add: [], remove: [] });
  // below every reward: reward roles held are removed, non-reward roles untouched
  assert.deepStrictEqual(lv.selectRewardChanges(rewards, 1, [R(1), R(9)], 'replace'), { add: [], remove: [R(1)] });
  // passing the top tier
  assert.deepStrictEqual(lv.selectRewardChanges(rewards, 50, [R(1), R(2), R(4)], 'replace'), { add: [R(3)], remove: [R(1), R(2), R(4)] });
});

test('rewardRoleProblem refuses missing, @everyone, managed and above-bot roles', () => {
  const guild = { id: 'G' };
  assert.match(lv.rewardRoleProblem(guild, null), /no longer exists/);
  assert.match(lv.rewardRoleProblem(guild, { id: 'G', editable: true }), /@everyone/);
  assert.match(lv.rewardRoleProblem(guild, { id: 'r', managed: true, editable: true }), /managed/);
  assert.match(lv.rewardRoleProblem(guild, { id: 'r', managed: false, editable: false }), /highest role/);
  assert.strictEqual(lv.rewardRoleProblem(guild, { id: 'r', managed: false, editable: true }), null);
});

test('computeMultiplier: highest role x most specific channel x global, capped at 10', () => {
  const roleMults = { a: 2, b: 3, c: 0.5 };
  const channelMults = { ch: 1.5, cat: 4 };
  assert.strictEqual(lv.computeMultiplier({}), 1);
  assert.strictEqual(lv.computeMultiplier({ roleIds: ['a', 'b', 'c'], roleMults }), 3); // highest, not product
  assert.strictEqual(lv.computeMultiplier({ roleIds: ['c'], roleMults }), 0.5);
  assert.strictEqual(lv.computeMultiplier({ roleIds: ['a'], channelIds: ['ch', 'cat'], roleMults, channelMults }), 3); // channel beats category
  assert.strictEqual(lv.computeMultiplier({ channelIds: ['x', 'cat'], channelMults }), 4); // falls back to category
  assert.strictEqual(lv.computeMultiplier({ roleIds: ['b'], channelIds: ['cat'], roleMults, channelMults, global: 2 }), 10); // 24 -> cap
  assert.strictEqual(lv.computeMultiplier({ global: 0 }), 0); // dashboard allows 0 = no XP
  assert.strictEqual(lv.computeMultiplier({ global: 2.5 }), 2.5);
});

test('computeMultiplier ignores junk config values', () => {
  const roleMults = { a: 'lots', b: NaN, c: 99, d: -1, e: Infinity, f: 0.01 };
  assert.strictEqual(lv.computeMultiplier({ roleIds: Object.keys(roleMults), roleMults, global: 'x' }), 1);
  assert.strictEqual(lv.computeMultiplier({ roleIds: ['a'], roleMults: [1, 2], channelMults: 'no', global: 50 }), 1);
});

test('isIgnored matches any channel in the chain or any held role', () => {
  assert.strictEqual(lv.isIgnored({ roleIds: ['r1'], channelIds: ['c1', 'cat'], ignoreChannels: ['cat'] }), true);
  assert.strictEqual(lv.isIgnored({ roleIds: ['r1'], channelIds: ['c1'], ignoreRoles: ['r1'] }), true);
  assert.strictEqual(lv.isIgnored({ roleIds: ['r1'], channelIds: ['c1'], ignoreChannels: ['c2'], ignoreRoles: ['r2'] }), false);
  assert.strictEqual(lv.isIgnored({ roleIds: ['r1'], channelIds: ['c1'], ignoreChannels: 'junk', ignoreRoles: null }), false);
});

test('channelChain walks thread -> channel -> category without duplicates', () => {
  assert.deepStrictEqual(lv.channelChain({ id: 't', parentId: 'c', parent: { parentId: 'cat' } }), ['t', 'c', 'cat']);
  assert.deepStrictEqual(lv.channelChain({ id: 'c', parentId: 'cat', parent: { parentId: null } }), ['c', 'cat']);
  assert.deepStrictEqual(lv.channelChain(null), []);
});

test('scaledAmount: 0 when multiplier is 0, at least 1 otherwise, capped', () => {
  assert.strictEqual(lv.scaledAmount(20, 0), 0);
  assert.strictEqual(lv.scaledAmount(5, 0.1), 1);
  assert.strictEqual(lv.scaledAmount(20, 1.5), 30);
  assert.strictEqual(lv.scaledAmount(1e6, 10), lv.LIMITS.AWARD_MAX);
  assert.strictEqual(lv.scaledAmount(NaN, 2), 0);
});

test('cleanTemplate enforces type, emptiness and the 300 char cap', () => {
  assert.deepStrictEqual(lv.cleanTemplate('  GG {user}\u0000!  '), { value: 'GG {user}!' });
  assert.ok(lv.cleanTemplate('').error);
  assert.ok(lv.cleanTemplate('   ').error);
  assert.ok(lv.cleanTemplate(null).error);
  assert.ok(lv.cleanTemplate('x'.repeat(301)).error);
  assert.deepStrictEqual(lv.cleanTemplate('x'.repeat(300)), { value: 'x'.repeat(300) });
});

test('renderLevelUpMessage fills variables and defuses mass mentions', () => {
  const out = lv.renderLevelUpMessage('GG {user}! Level {LEVEL} in {server} @everyone @here', { userId: '123', level: 7, serverName: 'Cool @everyone Place' });
  assert.strictEqual(out, 'GG <@123>! Level 7 in Cool @​everyone Place @​everyone @​here');
  const long = lv.renderLevelUpMessage('{server}'.repeat(37), { userId: '1', level: 1, serverName: 'x'.repeat(100) });
  assert.ok(long.length <= 2000);
});

test('parseTarget recognises roles, channels, ids, global and levels', () => {
  assert.deepStrictEqual(lv.parseTarget(`<@&${R(1)}>`), { type: 'role', id: R(1) });
  assert.deepStrictEqual(lv.parseTarget(`<#${R(2)}>`), { type: 'channel', id: R(2) });
  assert.deepStrictEqual(lv.parseTarget(` ${R(3)} `), { type: 'id', id: R(3) });
  assert.deepStrictEqual(lv.parseTarget('GLOBAL'), { type: 'global' });
  assert.deepStrictEqual(lv.parseTarget('15'), { type: 'level', level: 15 });
  assert.deepStrictEqual(lv.parseTarget('lol'), { type: null });
  assert.deepStrictEqual(lv.parseTarget(undefined), { type: null });
});

test('eligibleVoiceMembers: not alone, no bots, not deafened, not server muted, not AFK', () => {
  const st = (id, extra = {}, member = {}) => ({ channelId: 'vc', selfDeaf: false, serverDeaf: false, serverMute: false, ...extra, member: { id, user: { bot: false }, ...member } });
  // alone
  assert.deepStrictEqual(lv.eligibleVoiceMembers([st('a')]), []);
  // alone with a bot still counts as alone
  assert.deepStrictEqual(lv.eligibleVoiceMembers([st('a'), st('bot', {}, { user: { bot: true } })]), []);
  // two people: both earn
  assert.deepStrictEqual(lv.eligibleVoiceMembers([st('a'), st('b')]).map((m) => m.id), ['a', 'b']);
  // deafened / server-muted / timed out people neither earn nor count as company
  assert.deepStrictEqual(lv.eligibleVoiceMembers([st('a'), st('b', { selfDeaf: true })]), []);
  assert.deepStrictEqual(lv.eligibleVoiceMembers([st('a'), st('b', { serverMute: true })]), []);
  assert.deepStrictEqual(lv.eligibleVoiceMembers([st('a'), st('b', {}, { isCommunicationDisabled: () => true })]), []);
  // self-muted listeners are fine
  assert.deepStrictEqual(lv.eligibleVoiceMembers([st('a', { selfMute: true }), st('b')]).length, 2);
  // AFK channel
  assert.deepStrictEqual(lv.eligibleVoiceMembers([st('a'), st('b')], { afkChannelId: 'vc' }), []);
});

test('voiceRate defaults to 5 and caps', () => {
  assert.strictEqual(lv.voiceRate(undefined), 5);
  assert.strictEqual(lv.voiceRate('9'), 5);
  assert.strictEqual(lv.voiceRate(0), 5);
  assert.strictEqual(lv.voiceRate(12), 12);
  assert.strictEqual(lv.voiceRate(10 ** 6), lv.LIMITS.VOICE_RATE_MAX);
});
