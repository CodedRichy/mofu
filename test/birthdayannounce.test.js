const test = require('node:test');
const assert = require('node:assert');
const store = require('../src/database/store');
const birthdays = require('../src/database/birthday');
const { announceGuild } = require('../src/utils/birthdayAnnounce');

const G = '777000000000000001';
const CH = '777000000000000002';

function guild(sent, members) {
  return {
    id: G,
    channels: { cache: new Map([[CH, { send: async (m) => { sent.push(m); } }]]) },
    members: { cache: new Map(members.map((id) => [id, { user: { bot: false } }])), fetch: async () => { throw new Error('gone'); } },
  };
}

test('birthdays are announced once per UTC day, only for members still present, pinging only them', async () => {
  const sent = [];
  const now = new Date(Date.UTC(2027, 2, 14, 1, 0, 0));
  birthdays.setChannel(G, CH);
  birthdays.setBirthday(G, '888000000000000001', 3, 14);
  birthdays.setBirthday(G, '888000000000000002', 3, 14); // left the server
  birthdays.setBirthday(G, '888000000000000003', 3, 15); // another day
  try {
    const g = guild(sent, ['888000000000000001']);
    assert.equal(await announceGuild(g, now), 1);
    assert.equal(sent.length, 1);
    assert.match(sent[0].content, /888000000000000001/);
    assert.doesNotMatch(sent[0].content, /888000000000000002|888000000000000003/);
    assert.deepEqual(sent[0].allowedMentions, { users: ['888000000000000001'] });
    assert.equal(await announceGuild(g, now), 0, 'second sweep the same day posts nothing');
    assert.equal(sent.length, 1);
  } finally {
    for (const u of ['1', '2', '3']) birthdays.removeBirthday(G, '88800000000000000' + u);
    store.setConfig(G, 'birthday_channel', null);
    store.setConfig(G, 'birthday_last', null);
  }
});

test('no channel set means no post and no marker', async () => {
  const sent = [];
  assert.equal(await announceGuild(guild(sent, []), new Date()), 0);
  assert.equal(sent.length, 0);
});
