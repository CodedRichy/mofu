const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const backup = require('../src/utils/backup');
const rolepanels = require('../src/database/rolepanels');
const tagsDb = require('../src/database/tags');

function fakeStore(values) {
  const data = { ...values };
  return { data, getConfig: (g, k) => (k in data ? data[k] : null), setConfig: (g, k, v) => { data[k] = v; } };
}

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'mofu-rel-')); }

test('export has version 2, config, panels and tags, with the new settings', () => {
  const mem = new Database(':memory:');
  const rp = rolepanels.create(mem);
  const tg = tagsDb.create(mem);
  rp.createPanel({ guildId: 'g1', channelId: 'c1', title: 'Pick', createdBy: 'u1', entries: [{ roleId: 'r1', label: 'Red' }] });
  tg.createTag('g1', { name: 'rules', content: 'be kind', ownerId: 'u9' });
  const store = fakeStore({
    prefix: '!', punishment_presets: { spam: { action: 'mute' } }, voiceguard: true, scamshield: { on: true }, gambling_enabled: true,
    secret_token: 'nope', ticket_enabled: null,
  });
  const out = backup.buildExport({ id: 'g1', name: 'Test' }, { store, rolepanels: rp, tags: tg }, new Date('2026-01-01T00:00:00Z'));
  assert.equal(out._meta.version, 2);
  assert.equal(out._meta.exportedAt, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(Object.keys(out.config).sort(), ['gambling_enabled', 'prefix', 'punishment_presets', 'scamshield', 'voiceguard']);
  assert.equal(out.panels.length, 1);
  assert.equal(out.panels[0].entries[0].roleId, 'r1');
  assert.equal(out.tags[0].name, 'rules');
  const json = JSON.stringify(out);
  assert.ok(!json.includes('u1') && !json.includes('u9') && !json.includes('c1'), 'no creator, owner or channel ids');
  assert.ok(!json.includes('nope'), 'unlisted keys never leak');
});

test('export survives a missing panels/tags source', () => {
  const boom = { exportPanels() { throw new Error('x'); }, exportTags() { throw new Error('y'); } };
  const out = backup.buildExport({ id: 'g', name: 'T' }, { store: fakeStore({}), rolepanels: boom, tags: boom });
  assert.deepEqual(out.panels, []);
  assert.deepEqual(out.tags, []);
});

test('validateExport accepts v1 and v2, rejects the rest', () => {
  assert.equal(backup.validateExport({ _meta: { version: 1 }, config: {} }).ok, true);
  assert.equal(backup.validateExport({ _meta: { version: 2 }, config: {} }).ok, true);
  assert.equal(backup.validateExport({ _meta: { version: 3 }, config: {} }).ok, false);
  assert.equal(backup.validateExport({ _meta: { version: 2 }, config: [] }).ok, false);
  assert.equal(backup.validateExport(null).ok, false);
});

test('applyImport sets known keys, skips unknown, adds tags without overwriting', () => {
  const mem = new Database(':memory:');
  const tg = tagsDb.create(mem);
  tg.createTag('g1', { name: 'keep', content: 'original' });
  const store = fakeStore({});
  const r = backup.applyImport('g1', {
    config: { voiceguard: true, evil: 1 },
    tags: [{ name: 'keep', content: 'changed' }, { name: 'new', content: 'hello' }, { name: 'bad name!!', content: 'x' }],
    panels: [{}],
  }, { store, tags: tg });
  assert.equal(store.data.voiceguard, true);
  assert.deepEqual(r.skippedKeys, ['evil']);
  assert.equal(r.tagsAdded, 1);
  assert.equal(r.tagsSkipped, 2);
  assert.equal(r.panelsInFile, 1);
  assert.equal(tg.getTag('g1', 'keep').content, 'original');
});

test('snapshot copy: copies, keeps newest 7, never throws', () => {
  const src = tmpDir();
  const dst = tmpDir();
  try {
    for (let d = 1; d <= 9; d++) {
      const f = path.join(src, `sonder-202601${String(d).padStart(2, '0')}-0300.db`);
      fs.writeFileSync(f, 'x');
      assert.ok(backup.copySnapshot(f, dst));
    }
    assert.equal(backup.listBackups(dst).length, 7);
    assert.equal(backup.listBackups(dst)[0], 'sonder-20260109-0300.db');
    // copy target that cannot be created: returns null, no throw
    const blocker = path.join(src, 'afile');
    fs.writeFileSync(blocker, 'x');
    assert.equal(backup.copySnapshot(path.join(src, 'sonder-20260109-0300.db'), path.join(blocker, 'sub')), null);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dst, { recursive: true, force: true });
  }
});

test('syncCopy fills a missing newest snapshot only', () => {
  const src = tmpDir();
  const dst = tmpDir();
  try {
    fs.writeFileSync(path.join(src, 'sonder-20260105-0300.db'), 'x');
    assert.ok(backup.syncCopy(src, dst));
    assert.equal(backup.syncCopy(src, dst), null);
    assert.equal(backup.syncCopy(tmpDir(), dst), null);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dst, { recursive: true, force: true });
  }
});

test('copyDirFrom and lastBackupAt', () => {
  assert.equal(backup.copyDirFrom({}), null);
  assert.equal(backup.copyDirFrom({ BACKUP_COPY_DIR: '  ' }), null);
  assert.equal(backup.copyDirFrom({ BACKUP_COPY_DIR: 'D:\\b' }), 'D:\\b');
  const d = tmpDir();
  try {
    assert.equal(backup.lastBackupAt(d), null);
    fs.writeFileSync(path.join(d, 'sonder-20260105-0300.db'), 'x');
    assert.equal(backup.lastBackupAt(d), '2026-01-05T03:00:00.000Z');
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('healthz payload has the new fields and no secrets', async () => {
  const express = require('express');
  const { createApp } = require('../src/dashboard/server');
  const fakeDb = { prepare: () => ({ get: () => ({ ok: 1 }) }) };
  const client = { isReady: () => true, ws: { ping: 42 }, commands: new Map([['a', 1], ['b', 2]]), guilds: { cache: new Map() } };
  const app = createApp(client, { store: { db: fakeDb }, db: fakeDb });
  assert.ok(express);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.commands, 2);
    assert.equal(typeof body.providers.groq, 'boolean');
    assert.equal(typeof body.providers.gemini, 'boolean');
    assert.equal(body.sharding.sharded, false);
    assert.ok('lastBackupAt' in body);
    assert.ok(!/key|token|secret/i.test(JSON.stringify(Object.keys(body.providers))));
  } finally {
    server.close();
  }
});
