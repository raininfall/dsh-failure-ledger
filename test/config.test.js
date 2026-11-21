import test from 'node:test'
import assert from 'node:assert/strict'

import { CONFIG_DEFAULTS, normalizeConfig } from '../lib/config.js'

test('CONFIG_DEFAULTS pins the documented values', () => {
  assert.deepEqual(CONFIG_DEFAULTS, {
    ledgerPath: undefined,
    retentionDays: 90,
    scanOnStartup: true,
    scanConcurrency: 4,
    includeSubagents: true,
    includePtcDispatch: true,
    ignorePatterns: [],
    maxSignatureChars: 160,
  })
})

test('normalizeConfig fills defaults from an empty object', () => {
  const config = normalizeConfig({})
  assert.equal(config.retentionDays, 90)
  assert.equal(config.scanOnStartup, true)
  assert.equal(config.scanConcurrency, 4)
  assert.equal(config.includeSubagents, true)
  assert.equal(config.includePtcDispatch, true)
  assert.equal(config.maxSignatureChars, 160)
  assert.deepEqual(config.ignorePatterns, [])
  assert.equal(config.ledgerPath, undefined)
})

test('normalizeConfig rejects out-of-range and malformed values', () => {
  const cases = [
    { retentionDays: 0 },
    { retentionDays: 3651 },
    { retentionDays: 1.5 },
    { scanConcurrency: 0 },
    { scanConcurrency: 17 },
    { maxSignatureChars: 10 },
    { maxSignatureChars: 401 },
    { ignorePatterns: ['('] },
    { ignorePatterns: ['ok', ''] },
    { ledgerPath: 'rel/x.json' },
    { scanOnStartup: 'yes' },
  ]
  for (const raw of cases) {
    assert.throws(() => normalizeConfig(raw), /failure-ledger: /, JSON.stringify(raw))
  }
})

test('normalizeConfig ignores unknown keys', () => {
  const config = normalizeConfig({ nope: 1, retentionDays: 30 })
  assert.equal(config.nope, undefined)
  assert.equal(config.retentionDays, 30)
})

test('normalizeConfig compiles ignorePatterns once and freezes the result', () => {
  const config = normalizeConfig({ ignorePatterns: ['errno 2', 'nosuchfile'] })
  assert.equal(config.ignorePatterns.length, 2)
  for (const pattern of config.ignorePatterns) assert.ok(pattern instanceof RegExp)
  assert.equal(config.ignorePatterns[0].test('Error: errno 2 boom'), true)
  assert.ok(Object.isFrozen(config))
  assert.ok(Object.isFrozen(config.ignorePatterns))
})

test('normalizeConfig accepts a null or undefined raw config', () => {
  assert.equal(normalizeConfig(undefined).retentionDays, 90)
  assert.equal(normalizeConfig(null).retentionDays, 90)
})
