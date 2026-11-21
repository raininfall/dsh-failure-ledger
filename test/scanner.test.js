import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeConfig } from '../lib/config.js'
import { createScanner } from '../lib/scanner.js'

const DAY = 86_400_000
const BASE = 1_760_000_000_000

function text(value) {
  return [{ type: 'text', text: value }]
}

function failingEvents(seq, body = '[stderr]\nboom\n[exit code: 1]') {
  return [
    { type: 'tool/call', seq, time: BASE, data: { turn: 1, step: 1, callId: 'c1', name: 'bash' } },
    { type: 'tool/result', seq: seq + 1, time: BASE, data: { turn: 1, step: 1, message: { role: 'tool', id: `m${seq}`, toolCallId: 'c1', content: text(body), source: { kind: 'tool' } } } },
  ]
}

function makeSource(specs) {
  const state = new Map()
  for (const spec of specs) {
    state.set(spec.id, {
      id: spec.id,
      origin: spec.origin,
      cwd: spec.cwd ?? '/w',
      events: spec.events,
      title: spec.title ?? `title-${spec.id}`,
      revision: spec.revision ?? 1,
      eventCount: spec.eventCount ?? spec.events.length,
      sizeBytes: spec.sizeBytes ?? 100 * spec.id.length,
      statError: spec.statError,
    })
  }
  const source = {
    calls: { listSessions: 0, stat: 0, readSession: 0, readTitle: 0 },
    async listSessions() {
      source.calls.listSessions += 1
      return [...state.values()].map((entry) => ({
        header: { id: entry.id, createdAt: 0, cwd: entry.cwd, ...(entry.origin === undefined ? {} : { origin: entry.origin }) },
        live: false,
        persisted: true,
      }))
    },
    async stat(id) {
      source.calls.stat += 1
      const entry = state.get(id)
      if (entry.statError !== undefined) throw new Error(entry.statError)
      return { revision: entry.revision, eventCount: entry.eventCount, sizeBytes: entry.sizeBytes }
    },
    async readSession(id) {
      source.calls.readSession += 1
      const entry = state.get(id)
      return {
        session: { id: entry.id, createdAt: 0, cwd: entry.cwd, ...(entry.origin === undefined ? {} : { origin: entry.origin }) },
        inheritedEventCount: 0,
        capturedThroughSeq: entry.events.length,
        events: entry.events,
      }
    },
    async readTitle(id) {
      source.calls.readTitle += 1
      return { title: state.get(id).title }
    },
  }
  source.mutate = (id, patch) => {
    Object.assign(state.get(id), patch)
  }
  return source
}

function makeStore() {
  const data = { schemaVersion: 1, rulesVersion: 1, revision: 0, bootId: 'boot-1', updatedAt: 0, lastScanAt: 0, prefs: { ignored: [], merge: {} }, sessions: {} }
  const store = { data, saves: 0, touch() {}, isDirty() { return false }, async save() { store.saves += 1 } }
  return store
}

function makeScanner({ specs, config = {}, now = () => BASE, onProgress } = {}) {
  const source = makeSource(specs)
  const store = makeStore()
  let current = now
  const scanner = createScanner({
    source,
    store,
    config: normalizeConfig(config),
    bootId: 'boot-1',
    now: () => current(),
    onProgress,
  })
  return { scanner, source, store, setNow: (value) => { current = () => value } }
}

const THREE = [
  { id: 's1', events: failingEvents(1) },
  { id: 's2', events: failingEvents(1) },
  { id: 's3', events: [] },
]

test('the first run scans every session and records its failures', async () => {
  const { scanner, store } = makeScanner({ specs: THREE })
  const result = await scanner.run()
  assert.equal(result.scanned, 3)
  assert.equal(result.failed, 0)
  assert.equal(Object.keys(store.data.sessions).length, 3)
  assert.equal(store.data.sessions.s1.failures.length, 1)
  assert.deepEqual(store.data.sessions.s3.failures, [])
  assert.equal(store.data.sessions.s1.title, 'title-s1')
  assert.equal(store.data.sessions.s1.cwd, '/w')
  assert.equal(store.saves, 1)
})

test('an unchanged fingerprint skips the session entirely', async () => {
  const { scanner, source } = makeScanner({ specs: THREE })
  await scanner.run()
  const readsAfterFirst = source.calls.readSession
  const second = await scanner.run()
  assert.equal(second.scanned, 0)
  assert.equal(second.skipped, 3)
  assert.equal(source.calls.readSession, readsAfterFirst)
})

test('a changed fingerprint rescans only that session', async () => {
  const { scanner, source } = makeScanner({ specs: THREE })
  await scanner.run()
  source.mutate('s2', { revision: 2, eventCount: 99 })
  const second = await scanner.run()
  assert.equal(second.scanned, 1)
  assert.equal(second.skipped, 2)
})

test('full: true rescans even when the fingerprint is unchanged', async () => {
  const { scanner } = makeScanner({ specs: THREE })
  await scanner.run()
  const second = await scanner.run({ full: true })
  assert.equal(second.scanned, 3)
})

test('a stat failure is recorded per session and does not stop the run', async () => {
  const specs = [
    { id: 's1', events: failingEvents(1) },
    { id: 's2', events: failingEvents(1), statError: 'stat exploded' },
    { id: 's3', events: failingEvents(1) },
  ]
  const { scanner, store } = makeScanner({ specs })
  const result = await scanner.run()
  assert.equal(result.failed, 1)
  assert.equal(result.scanned, 2)
  assert.equal(store.data.sessions.s2.scanError, 'stat exploded')
  assert.equal(store.data.sessions.s1.failures.length, 1)
})

test('subagent sessions are skipped when includeSubagents is false', async () => {
  const specs = [
    { id: 's1', events: failingEvents(1) },
    { id: 's2', events: failingEvents(1), origin: 'subagent' },
    { id: 's3', events: [] },
  ]
  const { scanner, store } = makeScanner({ specs, config: { includeSubagents: false } })
  const result = await scanner.run()
  assert.equal(result.scanned, 2)
  assert.deepEqual(Object.keys(store.data.sessions).sort(), ['s1', 's3'])
})

test('failures past the retention window leave the ledger', async () => {
  const { scanner, store, setNow } = makeScanner({ specs: THREE })
  const first = await scanner.run()
  assert.equal(first.failures, 2)
  setNow(BASE + 91 * DAY)
  const second = await scanner.run()
  assert.equal(second.failures, 0)
  assert.equal(store.data.sessions.s1.failures.length, 0)
})

test('onProgress reports completion against the total', async () => {
  const progress = []
  const { scanner } = makeScanner({ specs: THREE, onProgress: (value) => progress.push(value) })
  await scanner.run()
  assert.ok(progress.length >= 1)
  assert.deepEqual(progress[progress.length - 1], { done: 3, total: 3 })
})

test('checkStale detects a changed fingerprint and queues the session', async () => {
  const { scanner, source } = makeScanner({ specs: THREE })
  await scanner.run()
  assert.equal(await scanner.checkStale(), false)
  source.mutate('s3', { revision: 2, sizeBytes: 12345 })
  assert.equal(await scanner.checkStale(), true)
  const result = await scanner.run()
  assert.equal(result.scanned, 1)
})

test('schedule collapses repeated requests into one run', async () => {
  const { scanner } = makeScanner({ specs: THREE })
  const first = scanner.schedule({ delayMs: 0 })
  const second = scanner.schedule({ delayMs: 0 })
  const third = scanner.schedule({ delayMs: 0 })
  assert.equal(first, second)
  assert.equal(second, third)
  const result = await first
  assert.equal(result.scanned, 3)
  assert.equal(scanner.status().scanning, false)
})

test('a ledger written by another boot falls back to durable counters', async () => {
  const { scanner, store, source } = makeScanner({ specs: THREE })
  await scanner.run()
  const second = createScanner({
    source,
    store,
    config: normalizeConfig({}),
    bootId: 'boot-2',
    now: () => BASE,
  })
  const next = await second.run()
  assert.equal(next.scanned, 0)
  assert.equal(next.skipped, 3)
  source.mutate('s1', { revision: 7, eventCount: 42, sizeBytes: 777 })
  const third = await second.run()
  assert.equal(third.scanned, 1)
})

test('sessions deleted from disk are dropped from the index', async () => {
  const { store, scanner } = makeScanner({ specs: THREE })
  await scanner.run()
  assert.equal(Object.keys(store.data.sessions).length, 3)
  store.data.sessions.gone = { fingerprint: {}, scannedAt: BASE, cwd: '/tmp', title: '', inheritedEventCount: 0, failures: [{ at: BASE, turn: 1, step: 1, seq: 2, tool: 'bash', kind: 'exit', signature: 'gone', line: 'gone', exitCode: 1 }] }
  const third = await scanner.run()
  assert.equal(store.data.sessions.gone, undefined, 'a session with no log behind it is dropped')
  assert.equal(third.scanned, 0)
})
