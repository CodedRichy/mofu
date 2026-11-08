const test = require('node:test');
const assert = require('node:assert');
const { parseTimezoneIntent } = require('../src/utils/tzIntent');

test('sets a timezone from a plain sentence, with either name', () => {
  for (const name of ['mofu', 'sonder', 'mofuuu']) {
    assert.deepStrictEqual(parseTimezoneIntent(`${name} set my tz as kolkata`), { verb: 'timezone', args: 'set Asia/Kolkata' });
  }
  assert.deepStrictEqual(parseTimezoneIntent('yo mofu change my timezone to Dubai!'), { verb: 'timezone', args: 'set Asia/Dubai' });
  assert.deepStrictEqual(parseTimezoneIntent('mofu set my tz to IST'), { verb: 'timezone', args: 'set Asia/Kolkata' });
});

test('ignores chat, unknown places and non-requests', () => {
  assert.strictEqual(parseTimezoneIntent('mofu set my tz as narnia'), null);
  assert.strictEqual(parseTimezoneIntent('mofu what is my tz'), null);
  assert.strictEqual(parseTimezoneIntent('i set my tz as kolkata'), null);
  assert.strictEqual(parseTimezoneIntent('mofu set the table'), null);
  assert.strictEqual(parseTimezoneIntent(''), null);
});

test('answerTimeQuestion computes the clock in code', () => {
  const { answerTimeQuestion } = require('../src/utils/tzIntent');
  const now = new Date('2026-11-08T06:09:00Z');
  assert.match(answerTimeQuestion('mofu what time is it in dubai?', now), /10:09 AM in Dubai/);
  assert.match(answerTimeQuestion("what's the time in tokyo", now), /3:09 PM in Tokyo/);
  assert.match(answerTimeQuestion('mofu what time is it right now in new york', now), /1:09 AM in New York/);
  assert.equal(answerTimeQuestion('what time is it in atlantis', now), null);
  assert.equal(answerTimeQuestion('what time does the event start', now), null);
});
