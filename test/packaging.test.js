import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

test('package.json declares the bundle patch and the host entry export', () => {
  assert.equal(manifest.name, 'dsh-failure-ledger')
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.exports['.'].default, './index.js')
})

test('cordis.patch.yml inserts exactly the failure-ledger row', () => {
  assert.match(patch, /- insert:/)
  assert.match(patch, /id: failure-ledger/)
  assert.match(patch, /name: dsh-failure-ledger/)
  assert.equal(patch.match(/- insert:/g).length, 1)
})

test('the host entry exports name, inject and a callable apply', async () => {
  const entry = await import('../index.js')
  assert.equal(entry.name, 'failure-ledger')
  assert.deepEqual(entry.inject, ['sessionQuery', 'sessionPersistence'])
  assert.equal(typeof entry.apply, 'function')
})

test('apply rejects an invalid config before touching the session store', async () => {
  const entry = await import('../index.js')
  await assert.rejects(
    () => entry.apply({ effect() {}, provide() {}, get() {}, on() {} }, { retentionDays: 0 }),
    /failure-ledger: config\.retentionDays/,
  )
})
