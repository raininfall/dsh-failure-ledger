import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/**
 * Evaluate the client fragments the way the bundle does: core first, then the
 * page, inside one sandbox that supplies a fake React.
 * @returns The page declarations under test.
 */
function load() {
  const CORE = readFileSync(new URL('../src/client/01-core.js', import.meta.url), 'utf8')
  const PAGE = readFileSync(new URL('../src/client/02-page.js', import.meta.url), 'utf8')
  const sandbox = {
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    console,
  }
  return vm.runInNewContext(`${CORE}\n${PAGE}\n({ nextSort, sortStateOf, queryOf, GroupTable })`, sandbox)
}

/**
 * Copy a value into this realm. Objects built inside the vm carry that realm's
 * prototypes, which strict deep-equality reports as a mismatch.
 * @param value - Value built by the vm domain.
 * @returns The same data with this realm's prototypes.
 */
const plain = (value) => JSON.parse(JSON.stringify(value))

test('clicking the active column flips direction, another column uses its default', () => {
  assert.deepEqual(plain(load().nextSort({ key: 'count', dir: 'desc' }, 'count')), { key: 'count', dir: 'asc' })
  assert.deepEqual(plain(load().nextSort({ key: 'count', dir: 'desc' }, 'tool')), { key: 'tool', dir: 'asc' })
  assert.deepEqual(plain(load().nextSort({ key: 'tool', dir: 'asc' }, 'lastAt')), { key: 'lastAt', dir: 'desc' })
  assert.deepEqual(plain(load().nextSort({ key: 'tool', dir: 'asc' }, 'sessionCount')), { key: 'sessionCount', dir: 'desc' })
})

test('aria-sort reports only the active column and its direction', () => {
  const { sortStateOf } = load()
  assert.deepEqual(plain(sortStateOf({ key: 'signature', dir: 'desc' }, 'signature')), { ariaSort: 'descending', arrow: '↓' })
  assert.deepEqual(plain(sortStateOf({ key: 'signature', dir: 'asc' }, 'signature')), { ariaSort: 'ascending', arrow: '↑' })
  assert.deepEqual(plain(sortStateOf({ key: 'signature', dir: 'asc' }, 'tool')), { ariaSort: 'none', arrow: '' })
})

test('every data header is a button and clicking it reports its key', () => {
  const t = (key) => key
  const calls = []
  const group = { groupId: 'g1', tool: 'bash', kind: 'exit', signature: 'boom', count: 1, sessionCount: 1, lastAt: 0, ignored: false }
  const tree = load().GroupTable({
    t, groups: [group], selected: [], sort: { key: 'signature', dir: 'desc' }, onSort: (key) => calls.push(key),
    onToggle() {}, onOpen() {}, onMute() {},
  })
  const cells = tree.children[0].children[0].children
  const sortable = cells.slice(1, 7)
  for (const cell of sortable) {
    assert.equal(cell.children[0].type, 'button')
    assert.equal(cell.children[0].props.className, 'dsh-fl-sort')
    assert.ok(['none', 'ascending', 'descending'].includes(cell.props['aria-sort']))
  }
  assert.equal(cells[4].props['aria-sort'], 'descending')
  assert.equal(cells[4].children[0].children[1].children[0], '↓')
  assert.equal(cells[4].children[0].children[1].props['aria-hidden'], 'true')
  assert.equal(cells[1].props['aria-sort'], 'none')
  cells[2].children[0].props.onClick()
  assert.deepEqual(calls, ['tool'])
})
