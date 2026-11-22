import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeConfig } from '../lib/config.js'
import { createService } from '../lib/service.js'
import { groupIdOf } from '../lib/signature.js'

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

test('a running scan reports its progress with the ledger', async () => {
  const scanner = fakeScanner()
  scanner.status = () => ({ scanning: true, progress: { done: 2, total: 9 }, lastRun: null, stale: [] })
  const { service } = makeService({ sessions: THREE_AND_TWO, scanner })
  const unchanged = await service.getLedger({}, 1)
  assert.equal(unchanged.scanning, true)
  assert.deepEqual(unchanged.progress, { done: 2, total: 9 })
  const full = await service.getLedger({}, null)
  assert.deepEqual(full.progress, { done: 2, total: 9 })
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

test('tool and signature sort in code-unit order', async () => {
  const sessions = {
    s1: entry([
      failure(BASE - 100, 'zeta', 'exit', 'b-line'),
      failure(BASE - 200, 'alpha', 'exit', 'a-line'),
      failure(BASE - 300, 'mike', 'exit', 'c-line'),
    ]),
  }
  const { service } = makeService({ sessions })
  const asc = await service.getLedger({ sort: [{ key: 'tool', dir: 'asc' }] })
  assert.deepEqual(asc.groups.map((group) => group.tool), ['alpha', 'mike', 'zeta'])
  const desc = await service.getLedger({ sort: [{ key: 'signature', dir: 'desc' }] })
  assert.deepEqual(desc.groups.map((group) => group.signature), ['c-line', 'b-line', 'a-line'])
})

test('a second column breaks ties left by the first', async () => {
  const sessions = {
    s1: entry([
      failure(BASE - 100, 'bash', 'exit', 'x'),
      failure(BASE - 101, 'bash', 'exit', 'y'),
      failure(BASE - 102, 'bash', 'timeout', 'z'),
      failure(BASE - 200, 'alpha', 'error', 'w'),
    ]),
  }
  const { service } = makeService({ sessions })
  const ledger = await service.getLedger({
    sort: [{ key: 'tool', dir: 'asc' }, { key: 'kind', dir: 'desc' }],
  })
  assert.deepEqual(
    ledger.groups.map((group) => `${group.tool}/${group.kind}`),
    ['alpha/error', 'bash/timeout', 'bash/exit', 'bash/exit'],
  )
})

test('each requested column applies its own direction', async () => {
  const sessions = {
    s1: entry([
      failure(BASE - 10, 'bash', 'exit', 'k'),
      failure(BASE - 11, 'bash', 'exit', 'k'),
      failure(BASE - 12, 'bash', 'exit', 'k'),
      failure(BASE - 20, 'bash', 'exit', 'j'),
      failure(BASE - 30, 'bash', 'timeout', 't'),
      failure(BASE - 31, 'bash', 'timeout', 't'),
    ]),
  }
  const { service } = makeService({ sessions })
  const ledger = await service.getLedger({
    sort: [{ key: 'kind', dir: 'desc' }, { key: 'count', dir: 'asc' }],
  })
  assert.deepEqual(
    ledger.groups.map((group) => `${group.kind}/${group.count}`),
    ['timeout/2', 'exit/1', 'exit/3'],
  )
})

test('an empty sort list falls back to most frequent first', async () => {
  const { service } = makeService({ sessions: THREE_AND_TWO })
  const ledger = await service.getLedger({ sort: [] })
  assert.deepEqual(ledger.groups.map((group) => group.count), [3, 2])
})

test('numeric columns sort both ways', async () => {
  const { service } = makeService({ sessions: THREE_AND_TWO })
  const asc = await service.getLedger({ sort: [{ key: 'count', dir: 'asc' }] })
  assert.deepEqual(asc.groups.map((group) => group.count), [2, 3])
  const sessions = await service.getLedger({ sort: [{ key: 'sessionCount', dir: 'desc' }] })
  assert.deepEqual(sessions.groups.map((group) => group.sessionCount), [2, 1])
})

test('kind sorts by the canonical kind order, unknown kinds last', async () => {
  const sessions = {
    s1: entry([
      failure(BASE - 100, 'bash', 'timeout', 't'),
      failure(BASE - 200, 'bash', 'exit', 'e'),
      failure(BASE - 300, 'bash', 'mystery', 'm'),
      failure(BASE - 400, 'bash', 'error', 'x'),
    ]),
  }
  const { service } = makeService({ sessions })
  const asc = await service.getLedger({ sort: [{ key: 'kind', dir: 'asc' }] })
  assert.deepEqual(asc.groups.map((group) => group.kind), ['error', 'exit', 'timeout', 'mystery'])
})

test('equal primary keys order by count before lastAt', async () => {
  const sessions = {
    s1: entry([
      failure(BASE - 300, 'bash', 'exit', 'three'),
      failure(BASE - 301, 'bash', 'exit', 'three'),
      failure(BASE - 302, 'bash', 'exit', 'three'),
      // Newer than the count-3 group, so only the count fallback can put the
      // frequent group first.
      failure(BASE - 50, 'bash', 'exit', 'one'),
    ]),
  }
  const { service } = makeService({ sessions })
  const ledger = await service.getLedger({ sort: [{ key: 'tool', dir: 'asc' }] })
  assert.deepEqual(ledger.groups.map((group) => group.count), [3, 1])
})

test('equal primary keys order by lastAt', async () => {
  const pairs = [
    { signature: 'aaa', groupId: groupIdOf('bash', 'exit', 'aaa') },
    { signature: 'bbb', groupId: groupIdOf('bash', 'exit', 'bbb') },
  ]
  // Give the newer timestamp to the group that sorts later by groupId, so the
  // groupId fallback cannot mask a dropped lastAt comparison.
  const newer = pairs[0].groupId > pairs[1].groupId ? pairs[0] : pairs[1]
  const older = newer === pairs[0] ? pairs[1] : pairs[0]
  const sessions = {
    s1: entry([
      failure(BASE - 200, 'bash', 'exit', older.signature),
      failure(BASE - 100, 'bash', 'exit', newer.signature),
    ]),
  }
  const { service } = makeService({ sessions })
  const ledger = await service.getLedger({ sort: [{ key: 'tool', dir: 'asc' }] })
  assert.deepEqual(ledger.groups.map((group) => group.signature), [newer.signature, older.signature])
})

test('equal primary keys order by groupId', async () => {
  const pairs = [
    { signature: 'aaa', groupId: groupIdOf('bash', 'exit', 'aaa') },
    { signature: 'bbb', groupId: groupIdOf('bash', 'exit', 'bbb') },
  ].sort((left, right) => (left.groupId < right.groupId ? 1 : -1))
  // Injected newest-first by groupId; only the groupId fallback can reorder them.
  const sessions = {
    s1: entry(pairs.map((pair) => failure(BASE - 100, 'bash', 'exit', pair.signature))),
  }
  const { service } = makeService({ sessions })
  const ledger = await service.getLedger({ sort: [{ key: 'tool', dir: 'asc' }] })
  const ids = ledger.groups.map((group) => group.groupId)
  assert.deepEqual(ids, [pairs[1].groupId, pairs[0].groupId])
  assert.deepEqual(ids, [...ids].sort())
})

test('limit applies after sorting, not before', async () => {
  const sessions = {
    s1: entry([
      failure(BASE - 100, 'zeta', 'exit', 'z'),
      failure(BASE - 101, 'zeta', 'exit', 'z'),
      failure(BASE - 102, 'zeta', 'exit', 'z'),
      failure(BASE - 200, 'mike', 'exit', 'm'),
      failure(BASE - 300, 'alpha', 'exit', 'a'),
    ]),
  }
  const { service } = makeService({ sessions })
  const top = await service.getLedger({ sort: [{ key: 'tool', dir: 'asc' }], limit: 2 })
  assert.deepEqual(top.groups.map((group) => group.tool), ['alpha', 'mike'])
})

test('a baseline drops failures recorded before it', async () => {
  const boom = groupIdOf('bash', 'exit', 'boom')
  const { service } = makeService({ sessions: THREE_AND_TWO, prefs: { ignored: [], merge: {}, since: { [boom]: BASE - 2000 } } })
  const ledger = await service.getLedger()
  const bash = ledger.groups.find((group) => group.signature === 'boom')
  assert.equal(bash.count, 1)
  assert.equal(ledger.totals.failures, 3)
})

test('a group with only pre-baseline failures disappears', async () => {
  const gone = groupIdOf('edit', 'error', 'gone')
  const { service } = makeService({ sessions: THREE_AND_TWO, prefs: { ignored: [], merge: {}, since: { [gone]: BASE } } })
  const ledger = await service.getLedger()
  assert.equal(ledger.groups.some((group) => group.signature === 'gone'), false)
  assert.equal(ledger.totals.failures, 3)
})

test('no baseline keeps every failure', async () => {
  const { service } = makeService({ sessions: THREE_AND_TWO, prefs: { ignored: [], merge: {}, since: {} } })
  const ledger = await service.getLedger()
  assert.equal(ledger.totals.failures, 5)
})

test('a baseline on a merged target also drops its sources', async () => {
  const boom = groupIdOf('bash', 'exit', 'boom')
  const gone = groupIdOf('edit', 'error', 'gone')
  const { service } = makeService({
    sessions: THREE_AND_TWO,
    prefs: { ignored: [], merge: { [boom]: gone }, since: { [gone]: BASE - 2000 } },
  })
  const ledger = await service.getLedger()
  assert.equal(ledger.groups.length, 1)
  assert.equal(ledger.groups[0].count, 2)
  assert.equal(ledger.totals.failures, 2)
})

test('a baseline set on a merged source lands on its target', async () => {
  const boom = groupIdOf('bash', 'exit', 'boom')
  const gone = groupIdOf('edit', 'error', 'gone')
  const { service } = makeService({ sessions: THREE_AND_TWO, prefs: { ignored: [], merge: { [boom]: gone }, since: {} } })
  const updated = await service.updatePrefs({ since: [{ groupId: boom, before: BASE - 2000 }] })
  assert.equal(updated.prefs.since[gone], BASE - 2000)
  assert.equal(updated.prefs.since[boom], undefined)
})

test('a baseline hides old occurrences from getGroup but unsince restores them', async () => {
  const boom = groupIdOf('bash', 'exit', 'boom')
  const { service, store } = makeService({ sessions: THREE_AND_TWO, prefs: { ignored: [], merge: {}, since: { [boom]: BASE - 2000 } } })
  const group = await service.getGroup(boom)
  assert.equal(group.total, 1)
  assert.equal(group.occurrences.length, 1)
  const updated = await service.updatePrefs({ unsince: [boom] })
  assert.deepEqual(updated.prefs.since, {})
  const restored = await service.getGroup(boom)
  assert.equal(restored.total, 3)
  assert.equal(store.data.prefs.since[boom], undefined)
})

test('updatePrefs sets a baseline on an unknown group and validates the time', async () => {
  const { service } = makeService({ sessions: THREE_AND_TWO })
  const updated = await service.updatePrefs({ since: [{ groupId: 'later-group', before: BASE }] })
  assert.equal(updated.prefs.since['later-group'], BASE)
  await assert.rejects(() => service.updatePrefs({ since: [{ groupId: 'x', before: 0 }] }), /positive/)
  await assert.rejects(() => service.updatePrefs({ since: [{ groupId: '', before: BASE }] }), /group id/)
})

test('a poll with a matching revision still counts post-baseline totals', async () => {
  const boom = groupIdOf('bash', 'exit', 'boom')
  const { service, store } = makeService({ sessions: THREE_AND_TWO, prefs: { ignored: [], merge: {}, since: { [boom]: BASE - 2000 } } })
  const ledger = await service.getLedger({}, store.data.revision)
  assert.equal(ledger.unchanged, true)
  assert.equal(ledger.totals.failures, 3)
})

test('getGroup carries the failure details needed to inspect it', async () => {
  const sessions = {
    s1: entry([failure(BASE - 1000, 'bash', 'exit', 'boom', { turn: 4, step: 2, exitCode: 127, callId: 'c1' })]),
  }
  const { service } = makeService({ sessions })
  const group = await service.getGroup(groupIdOf('bash', 'exit', 'boom'))
  const [occurrence] = group.occurrences
  assert.equal(occurrence.turn, 4)
  assert.equal(occurrence.step, 2)
  assert.equal(occurrence.exitCode, 127)
  assert.equal(occurrence.callId, 'c1')
  assert.equal(occurrence.signal, undefined)
})
