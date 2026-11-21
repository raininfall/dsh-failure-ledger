import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { TYPERT } from '../typert.js'
import { schemaFor } from '../lib/schemas.js'

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('the manifest is addressed to this package and face', () => {
  assert.equal(TYPERT.package, 'dsh-failure-ledger')
  assert.equal(TYPERT.package, PACKAGE.name)
  assert.equal(TYPERT.face, 'host')
  assert.ok(Array.isArray(TYPERT.schemas))
})

test('four invocations are exposed under the failureLedger service', () => {
  assert.equal(TYPERT.invocations.length, 4)
  const methods = TYPERT.invocations.map((invocation) => invocation.method)
  assert.deepEqual(methods.sort(), ['getGroup', 'getLedger', 'refresh', 'updatePrefs'])
  for (const invocation of TYPERT.invocations) {
    assert.equal(invocation.id, `dsh-failure-ledger#failureLedger/${invocation.method}`)
    assert.equal(invocation.service, 'failureLedger')
    assert.equal(invocation.namespace, 'failureLedger')
    assert.deepEqual(invocation.invocation, { kind: 'direct' })
  }
})

test('every parameter and result carries a strict codec with a create factory', () => {
  for (const invocation of TYPERT.invocations) {
    assert.ok(Array.isArray(invocation.parameters))
    for (const parameter of invocation.parameters) {
      assert.equal(parameter.wire, parameter.name)
      assert.equal(parameter.source, 'json')
      assert.equal(parameter.codec.mode, 'strict')
      assert.equal(typeof parameter.codec.create, 'function')
      assert.equal(parameter.codec.typeSymbol.startsWith('dsh-failure-ledger#'), true)
      assert.ok(parameter.codec.create() !== undefined)
    }
    assert.equal(invocation.result.mode, 'strict')
    assert.equal(typeof invocation.result.create, 'function')
    assert.ok(invocation.result.create() !== undefined)
  }
})

test('optional parameters accept undefined while required ones do not', () => {
  const getLedger = TYPERT.invocations.find((invocation) => invocation.method === 'getLedger')
  assert.deepEqual(getLedger.parameters.map((parameter) => parameter.name), ['query', 'knownRevision'])
  assert.equal(getLedger.parameters[0].acceptsUndefined, true)
  assert.equal(getLedger.parameters[1].acceptsUndefined, true)
  const getGroup = TYPERT.invocations.find((invocation) => invocation.method === 'getGroup')
  assert.deepEqual(getGroup.parameters.map((parameter) => parameter.name), ['groupId', 'limit'])
  assert.equal(getGroup.parameters[0].acceptsUndefined, undefined)
})

test('the model documents the failureLedger staff service', () => {
  assert.equal(TYPERT.model.services.length, 1)
  const service = TYPERT.model.services[0]
  assert.equal(service.key, 'failureLedger')
  assert.equal(service.exportName, 'createFailureLedgerService')
  assert.deepEqual(service.tags, [])
  assert.equal(service.members.length, 4)
  for (const member of service.members) {
    assert.equal(member.kind, 'method')
    assert.equal(typeof member.signature, 'string')
    assert.match(member.signature, /^[a-zA-Z]+\(/)
  }
  assert.deepEqual(TYPERT.model.events, [])
  assert.deepEqual(TYPERT.model.objects, [])
})

test('schemas cover the wire types and validate a real ledger result', () => {
  for (const name of ['Failure', 'GroupRow', 'Occurrence', 'Totals', 'LedgerResult', 'GroupResult', 'Prefs']) {
    const schema = schemaFor(name)
    assert.equal(schema?.mode, 'strict', name)
    assert.equal(typeof schema.create, 'function', name)
  }
  const ledgerResult = schemaFor('LedgerResult').create()
  const parsed = ledgerResult.safeParse({
    revision: 3,
    unchanged: false,
    scanning: false,
    totals: { failures: 1, groups: 1, sessions: 1, scanErrors: 0, unknownOutcome: 0, lastScanAt: 0 },
    groups: [
      { groupId: 'abc', tool: 'bash', kind: 'exit', signature: 'boom', count: 1, sessionCount: 1, lastAt: 1, ignored: false },
    ],
    prefs: { ignored: [], merge: {} },
    notices: [{ code: 'merge-target-missing', from: 'a', to: 'b' }],
  })
  assert.equal(parsed.success, true)
})
