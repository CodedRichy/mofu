// Backs up a throwaway database into a temp folder; never touches data/sonder.db or data/backups.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const backup = require('../src/utils/backup');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sonder-backup-test-')); }

test('stamp and parseStamp round-trip in UTC', () => {
  const d = new Date(Date.UTC(2026, 10, 8, 3, 7));
  assert.equal(backup.stamp(d), '20261108-0307');
  assert.equal(backup.parseStamp('sonder-20261108-0307.db'), d.getTime());
  assert.equal(backup.parseStamp('sonder.db'), null);
});

test('backupNow writes a readable snapshot and prunes to the newest 7', async () => {
  const dir = tmpDir();
  const srcPath = path.join(dir, 'src.db');
  const db = new Database(srcPath);
  db.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('hello')");
  try {
    // ten older backups plus an unrelated file that must never be deleted
    for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(dir, `sonder-202601${String(i + 10).padStart(2, '0')}-0000.db`), 'x');
    fs.writeFileSync(path.join(dir, 'keep-me.txt'), 'x');
    const file = await backup.backupNow(db, { dir, now: new Date(Date.UTC(2026, 10, 8, 12, 0)) });
    assert.equal(path.basename(file), 'sonder-20261108-1200.db');
    const copy = new Database(file, { readonly: true });
    assert.equal(copy.prepare('SELECT v FROM t').get().v, 'hello');
    copy.close();
    const left = backup.listBackups(dir);
    assert.equal(left.length, backup.KEEP);
    assert.equal(left[0], 'sonder-20261108-1200.db');
    assert.ok(fs.existsSync(path.join(dir, 'keep-me.txt')));
    assert.ok(fs.existsSync(srcPath));
    assert.ok(!fs.readdirSync(dir).some((n) => n.endsWith('.tmp')));
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('isDue: true with no backups, false right after one, true a day later', () => {
  const dir = tmpDir();
  try {
    assert.equal(backup.isDue(dir), true);
    const now = Date.UTC(2026, 10, 8, 12, 0);
    fs.writeFileSync(path.join(dir, `sonder-${backup.stamp(new Date(now))}.db`), 'x');
    assert.equal(backup.isDue(dir, now + 3600000), false);
    assert.equal(backup.isDue(dir, now + 86400000), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('start() is a no-op under the test runner and with BACKUPS=0', () => {
  assert.equal(backup.disabled(), true); // node --test sets NODE_TEST_CONTEXT
  assert.equal(backup.disabled({ BACKUPS: '0' }), true);
  assert.equal(backup.disabled({}), false);
  assert.equal(backup.start(), null);
});
