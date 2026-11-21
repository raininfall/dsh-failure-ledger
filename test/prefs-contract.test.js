import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../', import.meta.url)
const SOURCE = readFileSync(new URL('src/client/02-page.js', ROOT), 'utf8')

/**
 * Read the built client bundle and hand back its contribution descriptor.
 * @returns Descriptor list mounted by `apply`.
 */
function contribution() {
  const source = readFileSync(new URL('lib/client.js', ROOT), 'utf8')
  let captured
  const sandbox = {
    window: { __ModuleLoader__: { load(options) { captured = options } } },
    navigator: { language: 'en' },
    console,
  }
  vm.runInNewContext(source, sandbox)
  assert.ok(captured !== undefined, 'the bundle must register itself')
  let mounted
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useMemo: (factory) => factory(),
    useCallback: (callback) => callback,
    Fragment: 'fragment',
  }
  const exports = captured.factory((name) => {
    if (name === 'react') return react
    throw new Error(`unexpected require(${name})`)
  })
  const ctx = {
    locale: undefined,
    get: () => undefined,
    effect: (fn) => () => fn(),
    slots: { inject: (name, run) => run(), register: () => () => {} },
    remote: {
      $mount: async (value) => {
        mounted = value
        return () => {}
      },
    },
  }
  return exports.apply(ctx).then(() => mounted)
}

test('preference writes declare the patch as required', async () => {
  const mounted = await contribution()
  const descriptor = mounted.descriptors.find((entry) => entry.method === 'updatePrefs')
  assert.ok(descriptor, 'updatePrefs must be exposed to the client')
  assert.equal(descriptor.parameters.length, 1)
  assert.equal(descriptor.parameters[0].name, 'patch')
  assert.equal(descriptor.parameters[0].acceptsUndefined, undefined)
})

test('detail reads accept a group id and an optional limit', async () => {
  const mounted = await contribution()
  const descriptor = mounted.descriptors.find((entry) => entry.method === 'getGroup')
  assert.ok(descriptor, 'getGroup must be exposed to the client')
  assert.equal(descriptor.parameters.length, 2)
  assert.equal(descriptor.parameters[0].acceptsUndefined, undefined)
  assert.equal(descriptor.parameters[1].acceptsUndefined, true)
})

test('the panel keeps killed jobs hidden unless asked for', () => {
  assert.match(SOURCE, /includeJobKilled:\s*false/)
  assert.match(SOURCE, /hideIgnored:\s*true/)
})

test('the panel writes preferences for mute and merge', () => {
  assert.match(SOURCE, /ignore: \[groupId\]/)
  assert.match(SOURCE, /unignore: \[groupId\]/)
  assert.match(SOURCE, /merge: selected\.map\(\(from\) => \(\{ from, to \}\)\)/)
})

test('the panel loads a group detail and resolves a copy target', () => {
  assert.match(SOURCE, /service\s*\n?\s*\.getGroup\(/)
  assert.match(SOURCE, /navigator\.clipboard\.writeText\(sessionId\)/)
})

test('a manual rescan asks the host for a full sweep', () => {
  assert.match(SOURCE, /service\.refresh\(true\)/)
})

test('every detail and action key the panel renders exists in both languages', () => {
  const zh = JSON.parse(readFileSync(new URL('locale/zh.json', ROOT), 'utf8'))
  const en = JSON.parse(readFileSync(new URL('locale/en.json', ROOT), 'utf8'))
  const used = [...SOURCE.matchAll(/t\('([a-z]+\.[A-Za-z.]+)'/g)].map((match) => match[1])
  assert.ok(used.length > 0, 'the panel must translate its copy')
  for (const key of new Set(used)) {
    assert.ok(key in zh, `zh is missing ${key}`)
    assert.ok(key in en, `en is missing ${key}`)
  }
})

/**
 * Evaluate the page fragment on its own to reach `queryOf`.
 * @returns The fragment's `queryOf`.
 */
function queryOfProbe() {
  const sandbox = { React: { createElement: () => ({}) }, console }
  return vm.runInNewContext(`${SOURCE}\nqueryOf`, sandbox)
}

test('the query omits empty filters and defaults to hiding ignored groups', () => {
  const queryOf = queryOfProbe()
  const query = queryOf({ tool: '', text: '', kinds: [], includeJobKilled: false, hideIgnored: true, sort: 'count' })
  assert.deepEqual(JSON.parse(JSON.stringify(query)), {
    hideIgnored: true,
    sort: 'count',
  })
})

test('the query carries every active filter', () => {
  const queryOf = queryOfProbe()
  const query = queryOf({ tool: 'bash', text: 'not found', kinds: ['exit'], includeJobKilled: true, hideIgnored: false, sort: 'last' })
  assert.deepEqual(JSON.parse(JSON.stringify(query)), {
    hideIgnored: false,
    sort: 'last',
    tool: 'bash',
    text: 'not found',
    kinds: ['exit'],
    includeJobKilled: true,
  })
})
