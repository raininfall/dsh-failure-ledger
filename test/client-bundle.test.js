import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../', import.meta.url)
const OUT = fileURLToPath(new URL('lib/client.js', ROOT))
const PACKAGE = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8'))

function build() {
  return spawnSync(process.execPath, [fileURLToPath(new URL('scripts/build-client.js', ROOT))], { encoding: 'utf8' })
}

test('the client bundle builds into one parseable module', () => {
  const buildResult = build()
  assert.equal(buildResult.status, 0, buildResult.stderr)
  const text = readFileSync(OUT, 'utf8')
  assert.match(text, /__ModuleLoader__\.load\(/)
  assert.match(text, /id: 'dsh-failure-ledger'/)
  assert.match(text, /exports\.apply = apply/)
  assert.match(text, /exports\.inject = inject/)
  assert.match(text, /require\('react'\)/)
  const syntax = spawnSync(process.execPath, ['--check', OUT], { encoding: 'utf8' })
  assert.equal(syntax.status, 0, syntax.stderr)
})

test('the bundle registers the sidebar entry and a keyed main panel', () => {
  const text = readFileSync(OUT, 'utf8')
  assert.match(text, /['"]sidebar\.panellist['"]/)
  assert.match(text, /name: 'main'/)
  assert.match(text, /key: PANEL_ID/)
  assert.match(text, /const PANEL_ID = 'failure-ledger'/)
})

test('no fragment uses ESM syntax inside the factory', () => {
  for (const fragment of ['01-core.js', '02-page.js', '03-apply.js']) {
    const text = readFileSync(new URL(`src/client/${fragment}`, ROOT), 'utf8')
    assert.doesNotMatch(text, /^\s*export /m, fragment)
    assert.doesNotMatch(text, /^\s*import /m, fragment)
  }
})

test('both locale dictionaries carry the same keys', () => {
  const zh = JSON.parse(readFileSync(new URL('locale/zh.json', ROOT), 'utf8'))
  const en = JSON.parse(readFileSync(new URL('locale/en.json', ROOT), 'utf8'))
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  for (const key of ['panel', 'empty', 'title', 'refresh', 'scanning']) {
    assert.equal(typeof zh[key], 'string', key)
    assert.equal(typeof en[key], 'string', key)
  }
  for (const kind of ['error', 'exit', 'signal', 'timeout', 'job-failed', 'job-killed', 'ptc-error']) {
    assert.equal(typeof zh[`kind.${kind}`], 'string', kind)
    assert.equal(typeof en[`kind.${kind}`], 'string', kind)
  }
})

test('package.json declares the client face and its export', () => {
  assert.deepEqual(PACKAGE.dsh.client, { platform: 'web' })
  assert.equal(PACKAGE.exports['./client'].default, './lib/client.js')
})
