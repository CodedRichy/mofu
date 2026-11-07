const test = require('node:test');
const assert = require('node:assert');
const { parseCsv, parseWarningsCsv, MAX_ROWS } = require('../src/utils/csvImport');
const store = require('../src/database/store');

const U1 = '123456789012345678';
const U2 = '223456789012345678';
const MOD = '323456789012345678';

test('parseCsv handles quotes, embedded commas/newlines and CRLF', () => {
  const rows = parseCsv('a,b\r\n"x, y","line1\nline2"\r\n"say ""hi""",z');
  assert.deepStrictEqual(rows, [['a', 'b'], ['x, y', 'line1\nline2'], ['say "hi"', 'z']]);
});

test('reads a headed file with aliases and a unix timestamp', () => {
  const csv = `member_id,warning,issued_by,created_at\n${U1},"spam, again",${MOD},1700000000\n${U2},rude,,2023-05-01`;
  const { rows, errors } = parseWarningsCsv(csv);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].reason, 'spam, again');
  assert.strictEqual(rows[0].moderatorId, MOD);
  assert.strictEqual(rows[0].timestamp, new Date(1700000000 * 1000).toISOString());
  assert.strictEqual(rows[1].moderatorId, null);
});

test('a headerless file is read by position', () => {
  const { rows } = parseWarningsCsv(`${U1},being rude\n${U2},spam`);
  assert.deepStrictEqual(rows.map((r) => r.userId), [U1, U2]);
});

test('bad ids are skipped with a line number, good rows still import', () => {
  const { rows, errors } = parseWarningsCsv(`user_id,reason\nnot-an-id,x\n${U1},ok\n123,short`);
  assert.strictEqual(rows.length, 1);
  assert.match(errors[0], /line 2/);
  assert.strictEqual(errors.length, 2);
});

test('exact duplicate rows collapse, missing reason gets a default', () => {
  const { rows } = parseWarningsCsv(`user_id,reason\n${U1},same\n${U1},same\n${U2},`);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[1].reason, 'No reason provided');
});

test('dates before Discord existed or in the future are ignored, not trusted', () => {
  const { rows } = parseWarningsCsv(`user_id,reason,date\n${U1},a,2001-01-01\n${U2},b,2999-01-01`);
  assert.strictEqual(rows[0].timestamp, null);
  assert.strictEqual(rows[1].timestamp, null);
});

test('row cap is enforced and reported', () => {
  const big = ['user_id,reason'];
  for (let i = 0; i < MAX_ROWS + 50; i++) big.push(`${U1},reason ${i}`);
  const { rows, truncated } = parseWarningsCsv(big.join('\n'));
  assert.strictEqual(rows.length, MAX_ROWS);
  assert.strictEqual(truncated, true);
});

test('empty and header-only files fail cleanly', () => {
  assert.match(parseWarningsCsv('').errors[0], /empty/);
  assert.match(parseWarningsCsv('foo,bar\n1,2').errors[0], /no user column/);
});

test('imported warnings keep their original date in the store', () => {
  const g = 'test-guild-import';
  store.addWarning(g, U1, { reason: 'old one (imported)', moderator: MOD, timestamp: '2023-05-01T00:00:00.000Z' });
  store.addWarning(g, U1, { reason: 'bad date', moderator: MOD, timestamp: 'garbage' });
  const w = store.getWarnings(g, U1);
  assert.ok(w.some((x) => x.timestamp === '2023-05-01T00:00:00.000Z'));
  assert.ok(w.every((x) => !Number.isNaN(Date.parse(x.timestamp))));
  store.db.prepare('DELETE FROM warnings WHERE guild_id = ?').run(g);
});

test('an unterminated quote is reported and does not swallow the following rows', () => {
  const csv = `user_id,reason\n${U1},ok\n${U2},"never closed\n${U1},next row\n${U2},another`;
  const { rows, errors } = parseWarningsCsv(csv);
  assert.deepStrictEqual(rows.map((r) => r.reason), ['ok']);
  assert.strictEqual(errors.length, 1);
  assert.match(errors[0], /line 3.*never closed/);
});

test('a runaway quote stops at the field cap instead of merging the whole file', () => {
  const body = Array.from({ length: 3000 }, () => `${U1},spam reason text here`).join('\n');
  const { rows, errors } = parseWarningsCsv(`user_id,reason\n${U2},"oops\n${body}`);
  assert.strictEqual(rows.length, 0);
  assert.ok(errors.some((e) => /never closed/.test(e)));
});

test('a quote inside an unquoted field is just text', () => {
  const { rows, errors } = parseWarningsCsv(`user_id,reason\n${U1},5" nails\n${U2},fine`);
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(rows.map((r) => r.reason), ['5" nails', 'fine']);
});

test('semicolon and tab delimited files are detected', () => {
  const semi = parseWarningsCsv(`user_id;reason;moderator\n${U1};"a; b";${MOD}\n${U2};rude;`);
  assert.deepStrictEqual(semi.errors, []);
  assert.deepStrictEqual(semi.rows.map((r) => r.reason), ['a; b', 'rude']);
  assert.strictEqual(semi.rows[0].moderatorId, MOD);
  const tab = parseWarningsCsv(`user_id\treason\n${U1}\tspam, again\n${U2}\trude`);
  assert.deepStrictEqual(tab.errors, []);
  assert.deepStrictEqual(tab.rows.map((r) => r.reason), ['spam, again', 'rude']);
});

test('a comma file with a semicolon inside a reason is still comma delimited', () => {
  const { rows, errors } = parseWarningsCsv(`user_id,reason\n${U1},"a;b;c"`);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(rows[0].reason, 'a;b;c');
});
