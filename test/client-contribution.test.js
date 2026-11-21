import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../', import.meta.url)

/**
 * Build the client bundle, then interpret it the way the harness does: the
 * bundle calls `window.__ModuleLoader__.load`, and the factory receives a
 * `require` that resolves `react`.
 * @returns The module id and its exports.
 */
function loadBundle() {
  const build = spawnSync(process.execPath, [fileURLToPath(new URL('scripts/build-client.js', ROOT))], { encoding: 'utf8' })
  assert.equal(build.status, 0, build.stderr)
  const source = readFileSync(new URL('lib/client.js', ROOT), 'utf8')
  let captured
  const sandbox = {
    window: { __ModuleLoader__: { load(options) { captured = options } } },
    navigator: { language: 'en' },
    console,
  }
  vm.runInNewContext(source, sandbox)
  assert.ok(captured !== undefined, 'the bundle must register itself')
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: () => [undefined, () => {}],
    useEffect: () => {},
    useMemo: (factory) => factory(),
    useCallback: (callback) => callback,
    Fragment: 'fragment',
  }
  const exports = captured.factory((name) => {
    if (name === 'react') return react
    throw new Error(`unexpected require(${name})`)
  })
  return { id: captured.id, exports }
}

function fakeContext() {
  const mounts = []
  const registrations = []
  const ctx = {
    locale: undefined,
    get() {
      return undefined
    },
    effect(fn) {
      const dispose = fn()
      return () => (typeof dispose === 'function' ? dispose() : undefined)
    },
    slots: {
      inject(name, run) {
        run()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
    remote: {
      async $mount(contribution) {
        mounts.push(contribution)
        return () => {}
      },
    },
  }
  return { ctx, mounts, registrations }
}

test('the bundle registers one module id and exports apply and inject', () => {
  const { id, exports } = loadBundle()
  assert.equal(id, 'dsh-failure-ledger')
  assert.equal(typeof exports.apply, 'function')
  assert.ok(Array.isArray(exports.inject))
  assert.ok(exports.inject.includes('slots'))
  assert.ok(exports.inject.includes('remote'))
})

test('apply mounts one contribution covering the four service methods', async () => {
  const { exports } = loadBundle()
  const { ctx, mounts } = fakeContext()
  await exports.apply(ctx)
  assert.equal(mounts.length, 1)
  const contribution = mounts[0]
  assert.equal(contribution.package, 'dsh-failure-ledger')
  // Values cross a vm realm boundary, so compare by value string, not by prototype.
  const methods = contribution.descriptors.map((descriptor) => descriptor.method).sort().join(',')
  assert.equal(methods, 'getGroup,getLedger,refresh,updatePrefs')
})

test('every descriptor declares the argument count the host validates', async () => {
  const { exports } = loadBundle()
  const { ctx, mounts } = fakeContext()
  await exports.apply(ctx)
  const byMethod = new Map(mounts[0].descriptors.map((descriptor) => [descriptor.method, descriptor]))

  const getLedger = byMethod.get('getLedger')
  assert.equal(getLedger.parameters.map((parameter) => parameter.name).join(','), 'query,knownRevision')
  for (const parameter of getLedger.parameters) assert.equal(parameter.acceptsUndefined, true)

  const getGroup = byMethod.get('getGroup')
  assert.equal(getGroup.parameters.map((parameter) => parameter.name).join(','), 'groupId,limit')
  assert.equal(getGroup.parameters[0].acceptsUndefined, undefined)

  const refresh = byMethod.get('refresh')
  assert.equal(refresh.parameters.map((parameter) => parameter.name).join(','), 'full')

  const updatePrefs = byMethod.get('updatePrefs')
  assert.equal(updatePrefs.parameters.map((parameter) => parameter.name).join(','), 'patch')
  assert.equal(updatePrefs.parameters[0].acceptsUndefined, undefined)

  for (const descriptor of mounts[0].descriptors) {
    assert.equal(descriptor.result.mode, 'strict')
    assert.equal(typeof descriptor.result.create, 'function')
    assert.equal(typeof descriptor.result.create().parse, 'function')
  }
})

test('apply registers the sidebar entry and the keyed main panel', async () => {
  const { exports } = loadBundle()
  const { ctx, registrations } = fakeContext()
  await exports.apply(ctx)
  const sidebar = registrations.find((entry) => entry.options.name === 'sidebar.panellist')
  const main = registrations.find((entry) => entry.options.name === 'main')
  assert.ok(sidebar !== undefined)
  assert.equal(sidebar.options.id, 'failure-ledger')
  assert.equal(sidebar.options.order, 50)
  assert.equal(typeof sidebar.options.label, 'function')
  assert.equal(typeof sidebar.component, 'function')
  assert.ok(main !== undefined)
  assert.equal(main.options.key, 'failure-ledger')
  assert.equal(typeof main.component, 'function')
  const injected = main.options.inject()
  assert.equal(typeof injected.t, 'function')
  assert.equal(injected.t('panel'), 'Failure ledger')
})

test('the panel tolerates a missing remote service', async () => {
  const { exports } = loadBundle()
  const { ctx, registrations } = fakeContext()
  delete ctx.remote
  await exports.apply(ctx)
  assert.equal(registrations.length, 2)
  const main = registrations.find((entry) => entry.options.name === 'main')
  const injected = main.options.inject()
  assert.equal(injected.service, undefined)
})
