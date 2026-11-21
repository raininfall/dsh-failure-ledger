import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, inject, name } from '../index.js'
import { schemaFor } from '../lib/schemas.js'

function fakeContext() {
  const provided = new Map()
  const effects = []
  const query = {
    listSessions: async () => [],
    readSession: async () => ({ session: {}, inheritedEventCount: 0, capturedThroughSeq: 0, events: [] }),
    readTitleSnapshot: async () => ({ session: {}, title: { title: 'T' } }),
  }
  const persistence = { stat: async () => undefined }
  const ctx = {
    sessionQuery: query,
    sessionPersistence: persistence,
    effects: effects,
    provided: provided,
    provide(key, value) { provided.set(key, value) },
    effect(fn, label) { effects.push({ label, dispose: fn() }) },
    on() {},
    get(key) { return key === 'remote.failureLedger' ? provided.get('failureLedger') : undefined },
  }
  return ctx
}

test('the entry declares its name, injection and apply', () => {
  assert.equal(name, 'failure-ledger')
  assert.deepEqual(inject, ['sessionQuery', 'sessionPersistence'])
  assert.equal(typeof apply, 'function')
})

test('apply provides the service and creates the ledger file', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'failure-ledger-'))
  try {
    const ctx = fakeContext()
    await apply(ctx, { ledgerPath: join(directory, 'ledger.json'), scanOnStartup: false })
    const service = ctx.provided.get('failureLedger')
    assert.ok(service !== undefined)
    for (const method of ['getLedger', 'getGroup', 'refresh', 'updatePrefs']) {
      assert.equal(typeof service[method], 'function', method)
    }
    const ledger = await service.getLedger({}, null)
    assert.equal(ledger.groups.length, 0)
    assert.equal(ledger.totals.sessions, 0)
    const stored = JSON.parse(readFileSync(join(directory, 'ledger.json'), 'utf8'))
    assert.equal(storeShape(stored), true)
    assert.ok(ctx.effects.length >= 1)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('apply rejects an invalid configuration', async () => {
  const ctx = fakeContext()
  await assert.rejects(() => apply(ctx, { retentionDays: 0 }), /failure-ledger: config\.retentionDays/)
  assert.equal(ctx.provided.size, 0)
})

test('apply schedules a startup scan when configured', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'failure-ledger-'))
  try {
    const ctx = fakeContext()
    await apply(ctx, { ledgerPath: join(directory, 'ledger.json'), scanOnStartup: true })
    assert.ok(ctx.effects.some((effect) => effect.label.includes('startup scan')))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('the persisted ledger matches the LedgerResult-ish stored document', () => {
  assert.equal(schemaFor('LedgerResult').create().safeParse({
    revision: 0,
    unchanged: false,
    scanning: false,
    totals: { failures: 0, groups: 0, sessions: 0, scanErrors: 0, unknownOutcome: 0, lastScanAt: 0 },
    groups: [],
    prefs: { ignored: [], merge: {} },
    notices: [],
  }).success, true)
})

function storeShape(store) {
  return store.schemaVersion === 1 && Array.isArray(store.prefs?.ignored ?? []) && typeof store.sessions === 'object'
}
