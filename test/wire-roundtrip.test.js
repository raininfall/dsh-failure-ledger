import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLedger } from '../lib/ledger-store.js'
import { createScanner } from '../lib/scanner.js'
import { createService } from '../lib/service.js'
import { CONFIG_DEFAULTS } from '../lib/config.js'
import { RULES_VERSION } from '../lib/signature.js'
import { schemaFor } from '../lib/schemas.js'

const NOW = 1_760_000_000_000

/**
 * Build a service over one stored failure, without touching real sessions.
 * @returns The service under test.
 */
async function serviceWithOneFailure() {
  const store = await openLedger(join(mkdtempSync(join(tmpdir(), 'failure-ledger-wire-')), 'ledger.json'), {
    bootId: 'wire',
    rulesVersion: RULES_VERSION,
  })
  store.data.sessions.s1 = {
    fingerprint: {},
    scannedAt: NOW,
    cwd: '/tmp',
    title: 'demo',
    inheritedEventCount: 0,
    failures: [{ at: NOW, turn: 1, step: 1, seq: 5, tool: 'bash', kind: 'exit', signature: 'Error: boom', line: 'Error: boom', exitCode: 1 }],
  }
  const source = {
    async listSessions() {
      return []
    },
    async stat() {
      return undefined
    },
    async readSession() {
      return { inheritedEventCount: 0, events: [] }
    },
  }
  const config = { ...CONFIG_DEFAULTS, ignorePatterns: [] }
  const scanner = createScanner({ source, store, config, bootId: 'wire' })
  return createService({ store, scanner, config })
}

test('every remote result validates against the schema the client is told about', async () => {
  const service = await serviceWithOneFailure()
  const ledger = await service.getLedger()
  assert.ok(ledger.groups.length > 0, 'the fixture must produce one group')
  const group = await service.getGroup(ledger.groups[0].groupId)
  const prefs = await service.updatePrefs({ ignore: [ledger.groups[0].groupId] })

  for (const [name, value] of [['LedgerResult', ledger], ['GroupResult', group], ['UpdatePrefsResult', prefs]]) {
    const codec = schemaFor(name)
    assert.ok(codec !== undefined, `${name} must be a known schema`)
    assert.doesNotThrow(() => codec.create().parse(value), `${name} must accept the service output`)
  }
})

test('LedgerQuery carries ordered sort columns and rejects the old forms', () => {
  const schema = schemaFor('LedgerQuery').create()
  assert.doesNotThrow(() => schema.parse({ sort: [{ key: 'kind', dir: 'asc' }] }))
  assert.doesNotThrow(() =>
    schema.parse({ sort: [{ key: 'tool', dir: 'asc' }, { key: 'count', dir: 'desc' }] }),
  )
  assert.doesNotThrow(() => schema.parse({ sort: [] }))
  assert.throws(() => schema.parse({ sort: 'count' }))
  assert.throws(() => schema.parse({ sort: { key: 'count', dir: 'desc' } }))
  assert.throws(() => schema.parse({ sort: [{ key: 'nope', dir: 'asc' }] }))
  assert.throws(() => schema.parse({ sort: [{ key: 'count', dir: 'sideways' }] }))
})

test('an empty ledger also validates', async () => {
  const store = await openLedger(join(mkdtempSync(join(tmpdir(), 'failure-ledger-wire-')), 'ledger.json'), {
    bootId: 'wire',
    rulesVersion: RULES_VERSION,
  })
  const source = {
    async listSessions() {
      return []
    },
    async stat() {
      return undefined
    },
    async readSession() {
      return { inheritedEventCount: 0, events: [] }
    },
  }
  const config = { ...CONFIG_DEFAULTS }
  const service = createService({ store, scanner: createScanner({ source, store, config, bootId: 'wire' }), config })
  const ledger = await service.getLedger()
  assert.doesNotThrow(() => schemaFor('LedgerResult').create().parse(ledger))
  assert.deepEqual(ledger.groups, [])
})

test('ContextQuery and FailureContext validate over the wire', () => {
  const query = schemaFor('ContextQuery').create()
  assert.doesNotThrow(() => query.parse({ sessionId: 's1', seq: 3 }))
  assert.doesNotThrow(() => query.parse({ sessionId: 's1', seq: 3, maxChars: 500 }))
  assert.throws(() => query.parse({ seq: 3 }))
  const context = schemaFor('FailureContext').create()
  assert.doesNotThrow(() => context.parse({
    found: true, sessionId: 's1', seq: 3, sessionTitle: 'demo', turn: 1, tool: 'bash', kind: 'error',
    signature: 'boom', line: 'Error: boom', entries: [{ kind: 'tool', text: 'x' }], chars: 1, truncated: false, dropped: 0,
  }))
})
