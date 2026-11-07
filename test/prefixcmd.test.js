const test = require('node:test');
const assert = require('node:assert');
const { prefixProblem } = require('../src/commands/config/prefix');

test('normal prefixes of 1-5 visible characters are accepted', () => {
  for (const p of [';', '!', '!!', '$$', 'so.', 'son!!', '>>', '¿?', '\u{1F525}']) assert.strictEqual(prefixProblem(p), null, p);
});

test('empty, spaced, invisible and overlong prefixes are rejected with a message', () => {
  const bad = ['', ' ', '  ', '! !', 'a b', ' !', '!\t', '​', '!​', '‍', '⁠', ' ', 'ㅤ', '⠀', '﻿!', '‮!', '!\n', '\u0000', '123456', 'abcdef', '!!!!!!'];
  for (const p of bad) {
    const m = prefixProblem(p);
    assert.ok(typeof m === 'string' && m.length > 5, JSON.stringify(p));
  }
});
