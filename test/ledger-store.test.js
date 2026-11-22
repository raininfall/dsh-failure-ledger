import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SCHEMA_VERSION, emptyLedger, openLedger } from '../lib/ledger-store.js'

async function tempLedgerPath() {
  const dir = await mkdtemp(join(tmpdir(), 'failure-ledger-store-'))
  return { dir, path: join(dir, 'ledger.json') }
}

test('emptyLedger carries the documented shape', () => {
  const ledger = emptyLedger({ bootId: 'boot-1', rulesVersion: 3 })
  assert.equal(ledger.schemaVersion, SCHEMA_VERSION)
  assert.equal(ledger.rulesVersion, 3)
  assert.equal(ledger.revision, 0)
  assert.equal(ledger.bootId, 'boot-1')
  assert.deepEqual(ledger.prefs, { ignored: [], merge: {}, since: {} })
  assert.deepEqual(ledger.sessions, {})
})

test('a missing ledger file opens as an empty clean ledger', async () => {
  const { path } = await tempLedgerPath()
  const store = await openLedger(path, { bootId: 'boot-1', rulesVersion: 1 })
  assert.equal(store.data.schemaVersion, 1)
  assert.equal(store.data.revision, 0)
  assert.equal(store.data.bootId, 'boot-1')
  assert.equal(store.isDirty(), false)
  assert.deepEqual(store.data.prefs, { ignored: [], merge: {}, since: {} })
})

test('save() bumps revision and leaves no temporary file behind', async () => {
  const { dir, path } = await tempLedgerPath()
  const store = await openLedger(path, { bootId: 'boot-1', rulesVersion: 1 })
  store.touch()
  assert.equal(store.isDirty(), true)
  await store.save()
  assert.equal(store.isDirty(), false)
  const first = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(first.revision, 1)
  assert.equal(typeof first.updatedAt, 'number')

  store.touch()
  await store.save()
  const second = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(second.revision, 2)

  const residue = (await readdir(dir)).filter((entry) => entry.includes('.tmp-'))
  assert.deepEqual(residue, [])
})

test('a corrupt ledger file is preserved and replaced by an empty ledger', async () => {
  const { dir, path } = await tempLedgerPath()
  await writeFile(path, '{')
  const store = await openLedger(path, { bootId: 'boot-2', rulesVersion: 1 })
  assert.equal(store.data.revision, 0)
  assert.equal(store.data.recoveredCorrupt.from, path)
  assert.equal(typeof store.data.recoveredCorrupt.at, 'number')
  const backups = (await readdir(dir)).filter((entry) => entry.includes('.corrupt-'))
  assert.equal(backups.length, 1)
  assert.equal(await readFile(join(dir, backups[0]), 'utf8'), '{')
})

test('a newer schemaVersion is rejected instead of misread', async () => {
  const { path } = await tempLedgerPath()
  await writeFile(path, JSON.stringify({ schemaVersion: 2, revision: 1, sessions: {}, prefs: { ignored: [], merge: {}, since: {} } }))
  await assert.rejects(() => openLedger(path, { bootId: 'boot-3', rulesVersion: 1 }), /schemaVersion 2 is newer/)
})

test('a partial older file is completed with defaults', async () => {
  const { path } = await tempLedgerPath()
  await writeFile(path, JSON.stringify({ schemaVersion: 1, revision: 5, bootId: 'old' }))
  const store = await openLedger(path, { bootId: 'boot-4', rulesVersion: 1 })
  assert.equal(store.data.revision, 5)
  assert.deepEqual(store.data.prefs, { ignored: [], merge: {}, since: {} })
  assert.deepEqual(store.data.sessions, {})
  assert.equal(store.data.bootId, 'old')
})

test('an older ledger gains an empty since map', async () => {
  const { path } = await tempLedgerPath()
  await writeFile(path, JSON.stringify({ schemaVersion: 1, revision: 0, sessions: {}, prefs: { ignored: [], merge: {} } }))
  const store = await openLedger(path, { bootId: 'b', rulesVersion: 1 })
  assert.deepEqual(store.data.prefs.since, {})
})
