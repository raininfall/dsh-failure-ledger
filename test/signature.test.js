import test from 'node:test'
import assert from 'node:assert/strict'

import { RULES_VERSION, extractErrorLine, groupIdOf, normalizeLine, signatureOf } from '../lib/signature.js'

test('RULES_VERSION pins the signature rule set', () => {
  assert.equal(RULES_VERSION, 1)
})

test('signatureOf takes the first keyword line of a multi-line error', () => {
  const text = 'Error: BLOCKED by CC Safety Net\nReason: Command could not be safely analyzed (strict mode).\nRule: analysis.strict-unparseable'
  assert.equal(signatureOf(text), 'Error: BLOCKED by CC Safety Net')
})

test('signatureOf prefers the stderr section and drops the runtime echo', () => {
  const text = '[rtk] ran: cat foo\n[stderr]\nbash: zstdcat: command not found\n[exit code: 127]'
  assert.equal(signatureOf(text), 'bash: zstdcat: command not found')
})

test('signatureOf skips marker-only noise lines', () => {
  const text = '[stderr]\n===\n}\nactual: broke here\n[exit code: 1]'
  assert.equal(signatureOf(text), 'actual: broke here')
})

test('signatureOf tolerates empty and missing content', () => {
  assert.equal(signatureOf(''), '')
  assert.equal(signatureOf(undefined), '')
  assert.equal(signatureOf('   \n\t\n'), '')
})

test('signatureOf survives a 2MB single line and still truncates', () => {
  const text = `error ${'x'.repeat(2 * 1024 * 1024)}`
  const signature = signatureOf(text)
  assert.ok(signature.length <= 160)
})

test('signatureOf honours a smaller maxChars', () => {
  const text = 'error: abcdefghijklmnopqrstuvwxyz'
  assert.equal(signatureOf(text, { maxChars: 12 }), 'error: abcde')
})

test('normalizeLine rewrites paths, ids and numbers', () => {
  assert.equal(normalizeLine('  /Users/rain/x/y.txt:42:7  '), '<path>:<n>:<n>')
  assert.equal(normalizeLine('\u001b[31mboom\u001b[0m'), 'boom')
  assert.equal(normalizeLine('C:\\Users\\rain\\a.ts failed'), '<path> failed')
  assert.equal(normalizeLine('trace deadbeef1234 done'), 'trace <id> done')
  assert.equal(normalizeLine('tsc said   a   thing'), 'tsc said a thing')
})

test('extractErrorLine returns the raw un-normalized line', () => {
  assert.equal(extractErrorLine('[stderr]\nfailed at /Users/rain/x.ts:12'), 'failed at /Users/rain/x.ts:12')
})

test('groupIdOf is a stable 16-character digest of tool, kind and signature', () => {
  const id = groupIdOf('bash', 'exit', 'boom')
  assert.match(id, /^[0-9a-f]{16}$/)
  assert.equal(groupIdOf('bash', 'exit', 'boom'), id)
  assert.notEqual(groupIdOf('bash', 'exit', 'other'), id)
  assert.notEqual(groupIdOf('bash', 'signal', 'boom'), id)
  assert.notEqual(groupIdOf('edit', 'exit', 'boom'), id)
})

test('a keyword buried inside an identifier does not outrank a real verdict', () => {
  const text = '[stderr]\nconst ok = isError(result)\nError: boom\n[exit code: 1]'
  assert.equal(extractErrorLine(text), 'Error: boom')
})

test('a stack-trace verdict outranks an echoed source line that mentions error', () => {
  const text = "[stderr]\ntest('an isError result becomes one error record', () => {\nAssertionError: expected 1 to equal 2\n[exit code: 1]"
  assert.equal(extractErrorLine(text), 'AssertionError: expected 1 to equal 2')
})
