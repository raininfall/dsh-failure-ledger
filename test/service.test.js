import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeConfig } from '../lib/config.js'
import { createService } from '../lib/service.js'

const BASE = 1_760_000_000_000

function failure(at, tool, kind, signature, extra = {}) {
  return { at, turn: 1, step: 1, seq: 1, tool, kind, signature, line: signature, ...extra }
}

function entry(failures, extra = {}) {
  return { fingerprint: { eventCount: 1, sizeBytes: 10 }, scannedAt: BASE, cwd: '/w', title: 'T', inheritedEventCount: 0, failures, ...extra }
}

function fakeStore(sessions = {}, prefs = { ignored: [], merge: {} }) {
  const store = {
    data: { schemaVersion: 1, rulesVersion: 1, revision: 1, bootId: 'boot-1', updatedAt: 0, lastScanAt: 0, prefs, sessions },
    saves: 0,
    touch() {},
    isDirty() { return false },
    async save() { store.data.revision += 1; store.saves += 1 },
  }
  return store
}

function fakeScanner() {
  const scanner = {
    checkStaleCalls: 0,
    runCalls: [],
    async checkStale() { scanner.checkStaleCalls += 1; return false },
    async run(options = {}) { scanner.runCalls.push(options); return { scanned: 1, skipped: 0, failed: 0, failures: 1, durationMs: 1 } },
  }
  return scanner
}

function makeService({ sessions, prefs, config = {}, scanner } = {}) {
  const store = fakeStore(sessions, prefs)
  const fake = scanner ?? fakeScanner()
  const service = createService({ store, scanner: fake, config: normalizeConfig(config), now: () => BASE })
  return { service, store, scanner: fake }
}

const THREE_AND_TWO = {
  s1: entry([failure(BASE - 3000, 'bash', 'exit', 'boom'), failure(BASE - 2000, 'bash', 'exit', 'boom'), failure(BASE - 1000, 'bash', 'exit', 'boom'), failure(BASE - 500, 'edit', 'error', 'gone')]),
  s2: entry([failure(BASE - 4000, 'edit', 'error', 'gone')]),
}

test('groups are ordered by descending count', async () => {
  const { service } = makeService({ sessions: THREE_AND_TWO })
  const ledger = await service.getLedger()
  assert.equal(ledger.groups.length, 2)
  assert.equal(ledger.groups[0].signature, 'boom')
  assert.equal(ledger.groups[0].count, 3)
  assert.equal(ledger.groups[1].signature, 'gone')
  assert.equal(ledger.groups[1].count, 2)
  assert.equal(ledger.totals.failures, 5)
  assert.equal(ledger.totals.sessions, 2)
})

test('sessionCount deduplicates sessions within a group', async () => {
  const { service } = makeService({ sessions: THREE_AND_TWO })
  const ledger = await service.getLedger()
  assert.equal(ledger.groups[0].sessionCount, 1)
  assert.equal(ledger.groups[1].sessionCount, 2)
})

test('ignored groups are hidden by default and flagged when asked for', async () => {
  const { service, store } = makeService({ sessions: THREE_AND_TWO })
  const before = await service.getLedger()
  const target = before.groups[0].groupId
  await service.updatePrefs({ ignore: [target] })
  const hidden = await service.getLedger({}, null)
  assert.deepEqual(hidden.groups.map((group) => group.groupId), [before.groups[1].groupId])
  const shown = await service.getLedger({ hideIgnored: false })
  const flagged = shown.groups.find((group) => group.groupId === target)
  assert.equal(flagged.ignored, true)
  assert.ok(store.saves >= 1)
})

test('a merge folds the source group into its target', async () => {
  const sessions = {
    s1: entry([failure(BASE - 3000, 'bash', 'exit', 'boom'), failure(BASE - 100, 'bash', 'exit', 'bang')]),
  }
  const { service } = makeService({ sessions })
  const before = await service.getLedger({}, null)
  const from = before.groups.find((group) => group.signature === 'bang').groupId
  const to = before.groups.find((group) => group.signature === 'boom').groupId
  await service.updatePrefs({ merge: [{ from, to }] })
  const after = await service.getLedger({}, null)
  assert.equal(after.groups.length, 1)
  assert.equal(after.groups[0].groupId, to)
  assert.equal(after.groups[0].count, 2)
  assert.deepEqual(after.groups[0].mergedFrom, [from])
})

test('a merge whose target no longer exists is reported, not invented', async () => {
  const sessions = { s1: entry([failure(BASE - 100, 'bash', 'exit', 'boom')]) }
  const { service, store } = makeService({ sessions })
  const before = await service.getLedger({}, null)
  const from = before.groups[0].groupId
  store.data.prefs.merge = { [from]: 'deadbeefdeadbeef' }
  const after = await service.getLedger({}, null)
  assert.deepEqual(after.groups.map((group) => group.groupId).includes('deadbeefdeadbeef'), false)
  assert.equal(after.notices.some((notice) => notice.code === 'merge-target-missing'), true)
})

test('query text and kind filters narrow the grouped result', async () => {
  const { service } = makeService({ sessions: THREE_AND_TWO })
  const text = await service.getLedger({ text: 'BOO' })
  assert.equal(text.groups.length, 1)
  assert.equal(text.groups[0].signature, 'boom')
  const kinds = await service.getLedger({ kinds: ['error'] })
  assert.equal(kinds.groups.length, 1)
  assert.equal(kinds.groups[0].kind, 'error')
})

test('killed background jobs are excluded unless requested', async () => {
  const sessions = {
    s1: entry([failure(BASE - 10, 'bash', 'job-killed', 'Download stalled'), failure(BASE - 20, 'bash', 'exit', 'boom')]),
  }
  const { service } = makeService({ sessions })
  const hidden = await service.getLedger({}, null)
  assert.deepEqual(hidden.groups.map((group) => group.kind), ['exit'])
  const shown = await service.getLedger({ includeJobKilled: true })
  assert.deepEqual(shown.groups.map((group) => group.kind).sort(), ['exit', 'job-killed'])
})

test('a known revision short-circuits the grouping', async () => {
  const { service, store } = makeService({ sessions: THREE_AND_TWO })
  const ledger = await service.getLedger({}, store.data.revision)
  assert.equal(ledger.unchanged, true)
  assert.deepEqual(ledger.groups, [])
  assert.equal(ledger.revision, store.data.revision)
})

test('updatePrefs ignores, unignores, merges and unmerges with a revision bump', async () => {
  const { service, store } = makeService({ sessions: THREE_AND_TWO })
  const before = await service.getLedger({}, null)
  const boom = before.groups[0].groupId
  const gone = before.groups[1].groupId
  assert.equal(boom.split('').length === 0, false)

  const revisionBefore = store.data.revision
  await service.updatePrefs({ ignore: [boom] })
  assert.equal(store.data.prefs.ignored.includes(boom), true)
  assert.equal(store.data.revision, revisionBefore + 1)

  await service.updatePrefs({ unignore: [boom] })
  assert.equal(store.data.prefs.ignored.includes(boom), false)

  await assert.rejects(() => service.updatePrefs({ merge: [{ from: boom, to: gone }] }), /same tool and kind/)
  await service.updatePrefs({ unmerge: [boom] })
})

test('getLedger triggers at most one stale check and does not await it', async () => {
  const scanner = {
    checkStaleCalls: 0,
    checkStale() { scanner.checkStaleCalls += 1; return new Promise(() => {}) },
    async run() { return { scanned: 0 } },
  }
  const { service } = makeService({ sessions: THREE_AND_TWO, scanner })
  const ledger = await service.getLedger()
  assert.equal(ledger.groups.length, 2)
  assert.equal(scanner.checkStaleCalls, 1)
})

test('refresh runs the scanner and reports its summary', async () => {
  const { service, scanner } = makeService({ sessions: THREE_AND_TWO })
  const result = await service.refresh(true)
  assert.deepEqual(scanner.runCalls, [{ full: true }])
  assert.equal(result.scanned, 1)
})

test('getGroup lists the occurrences of one group', async () => {
  const { service } = makeService({ sessions: THREE_AND_TWO })
  const ledger = await service.getLedger({}, null)
  const group = ledger.groups[0]
  const detail = await service.getGroup(group.groupId, 10)
  assert.equal(detail.groupId, group.groupId)
  assert.equal(detail.occurrences.length, 3)
  assert.equal(detail.occurrences[0].sessionId.startsWith('s'), true)
  assert.equal(detail.total, 3)
})
