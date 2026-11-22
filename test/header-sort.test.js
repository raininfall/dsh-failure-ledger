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
    // React flattens array children; the tree assertions rely on the same order.
    React: { createElement: (type, props, ...children) => ({ type, props, children: children.flat(Infinity) }) },
    console,
  }
  return vm.runInNewContext(`${CORE}\n${PAGE}\n({ nextSort, sortStateOf, queryOf, GroupTable, SortBar })`, sandbox)
}

/**
 * Copy a value into this realm. Objects built inside the vm carry that realm's
 * prototypes, which strict deep-equality reports as a mismatch.
 * @param value - Value built by the vm domain.
 * @returns The same data with this realm's prototypes.
 */
const plain = (value) => JSON.parse(JSON.stringify(value))

test('clicking a new column appends it, clicking an active one flips it in place', () => {
  const { nextSort } = load()
  assert.deepEqual(plain(nextSort([{ key: 'count', dir: 'desc' }], 'count')), [{ key: 'count', dir: 'asc' }])
  assert.deepEqual(plain(nextSort(undefined, 'tool')), [{ key: 'tool', dir: 'asc' }])
  // The first click away from the default order replaces it.
  assert.deepEqual(plain(nextSort([{ key: 'count', dir: 'desc' }], 'tool')), [{ key: 'tool', dir: 'asc' }])
  assert.deepEqual(plain(nextSort([{ key: 'tool', dir: 'asc' }], 'lastAt')), [
    { key: 'tool', dir: 'asc' },
    { key: 'lastAt', dir: 'desc' },
  ])
  assert.deepEqual(plain(nextSort([{ key: 'count', dir: 'desc' }, { key: 'tool', dir: 'asc' }], 'count')), [
    { key: 'count', dir: 'asc' },
    { key: 'tool', dir: 'asc' },
  ])
  assert.deepEqual(plain(nextSort([{ key: 'count', dir: 'desc' }, { key: 'tool', dir: 'asc' }], 'lastAt')), [
    { key: 'count', dir: 'desc' },
    { key: 'tool', dir: 'asc' },
    { key: 'lastAt', dir: 'desc' },
  ])
})

test('aria-sort reports every sorted column and its own direction', () => {
  const { sortStateOf } = load()
  const columns = [
    { key: 'signature', dir: 'desc' },
    { key: 'tool', dir: 'asc' },
  ]
  assert.deepEqual(plain(sortStateOf(columns, 'signature')), { ariaSort: 'descending', arrow: '↓' })
  assert.deepEqual(plain(sortStateOf(columns, 'tool')), { ariaSort: 'ascending', arrow: '↑' })
  assert.deepEqual(plain(sortStateOf(columns, 'kind')), { ariaSort: 'none', arrow: '' })
})

test('every data header is a button and clicking it reports its key', () => {
  const t = (key) => key
  const calls = []
  const group = { groupId: 'g1', tool: 'bash', kind: 'exit', signature: 'boom', count: 1, sessionCount: 1, lastAt: 0, ignored: false }
  const tree = load().GroupTable({
    t,
    groups: [group],
    selected: [],
    sort: [{ key: 'signature', dir: 'desc' }, { key: 'tool', dir: 'asc' }],
    onSort: (key) => calls.push(key),
    onToggle() {},
    onOpen() {},
    onMute() {},
  })
  const cells = tree.children[0].children[0].children
  const sortable = cells.slice(1, 7)
  for (const cell of sortable) {
    assert.equal(cell.children[0].type, 'button')
    assert.equal(cell.children[0].props.className, 'dsh-fl-sort')
    assert.equal(cell.children[0].props.title, 'sort.hint')
    assert.ok(['none', 'ascending', 'descending'].includes(cell.props['aria-sort']))
  }
  assert.equal(cells[4].props['aria-sort'], 'descending')
  assert.equal(cells[4].children[0].children[1].children[0], '↓')
  assert.equal(cells[4].children[0].children[1].props['aria-hidden'], 'true')
  assert.equal(cells[2].props['aria-sort'], 'ascending')
  assert.equal(cells[1].props['aria-sort'], 'none')
  cells[3].children[0].props.onClick()
  assert.deepEqual(calls, ['kind'])
})

test('the sort strip lists the columns in priority order and clears them', () => {
  const t = (key) => key
  const { SortBar } = load()
  assert.equal(SortBar({ t, sort: [{ key: 'count', dir: 'desc' }], onClear() {} }), null)
  const cleared = []
  const tree = SortBar({
    t,
    sort: [
      { key: 'count', dir: 'desc' },
      { key: 'tool', dir: 'asc' },
    ],
    onClear: () => cleared.push(true),
  })
  assert.equal(tree.type, 'div')
  assert.equal(tree.props.className, 'dsh-fl-sortbar')
  const [label, first, second, clear] = tree.children
  assert.equal(label.children[0], 'sort.label')
  assert.equal(first.props.className, 'dsh-fl-chip dsh-fl-sort-chip')
  assert.deepEqual(first.children, ['1. column.count ↓'])
  assert.deepEqual(second.children, ['2. column.tool ↑'])
  clear.props.onClick()
  assert.deepEqual(cleared, [true])
})

test('a single non-default column is listed without an order number', () => {
  const tree = load().SortBar({ t: (key) => key, sort: [{ key: 'lastAt', dir: 'desc' }], onClear() {} })
  assert.deepEqual(tree.children[1].children, ['column.lastAt ↓'])
})
