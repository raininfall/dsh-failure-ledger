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
  return vm.runInNewContext(`${CORE}\n${PAGE}\n({ GroupTable, GroupDetail })`, sandbox)
}

/**
 * Copy a value into this realm. Objects built inside the vm carry that realm's
 * prototypes, which strict deep-equality reports as a mismatch.
 * @param value - Value built by the vm domain.
 * @returns The same data with this realm's prototypes.
 */
const plain = (value) => JSON.parse(JSON.stringify(value))

/**
 * Find the first button whose visible label is `label`.
 * @param node - Render tree root.
 * @param label - Button text.
 * @returns The matching node, or undefined.
 */
function findButton(node, label) {
  if (node === null || typeof node !== 'object') return undefined
  if (node.type === 'button' && node.children?.[0] === label) return node
  for (const child of node.children ?? []) {
    const found = findButton(child, label)
    if (found !== undefined) return found
  }
  return undefined
}

test('a non-ignored row offers the baseline action', () => {
  const t = (key) => key
  const calls = []
  const group = { groupId: 'g1', tool: 'bash', kind: 'exit', signature: 'boom', count: 2, sessionCount: 1, lastAt: 0, ignored: false }
  const tree = load().GroupTable({ t, groups: [group], selected: [], sort: [{ key: 'count', dir: 'desc' }], activeId: undefined, onSort() {}, onToggle() {}, onOpen() {}, onMute() {}, onBaseline: (id) => calls.push(id) })
  const button = findButton(tree, 'action.baseline')
  assert.ok(button !== undefined)
  button.props.onClick({ stopPropagation() {} })
  assert.deepEqual(calls, ['g1'])
})

test('an ignored row does not offer the baseline action', () => {
  const t = (key) => key
  const group = { groupId: 'g1', tool: 'bash', kind: 'exit', signature: 'boom', count: 2, sessionCount: 1, lastAt: 0, ignored: true }
  const tree = load().GroupTable({ t, groups: [group], selected: [], sort: [], onSort() {}, onToggle() {}, onOpen() {}, onMute() {}, onBaseline() {} })
  assert.equal(findButton(tree, 'action.baseline'), undefined)
})

test('each occurrence offers its context and the viewer renders the entries', () => {
  const t = (key, values) => (values === undefined ? key : key.replace(/\{(\w+)\}/g, (_, name) => String(values[name])))
  const seen = []
  const occurrence = { at: 0, sessionId: 's1', sessionTitle: 'S', cwd: '/w', seq: 7, tool: 'bash', kind: 'error', line: 'boom', turn: 2, step: 2 }
  const group = { groupId: 'g1', tool: 'bash', kind: 'error', signature: 'boom', occurrences: [occurrence] }
  const detail = load().GroupDetail({ t, group, onClose() {}, onCopySession() {}, onContext: (value) => seen.push(value), onCloseContext() {} })
  findButton(detail, 'action.context').props.onClick()
  assert.deepEqual(plain(seen), [plain(occurrence)])
  const withContext = load().GroupDetail({
    t,
    group,
    onClose() {},
    onCopySession() {},
    onContext() {},
    onCloseContext() {},
    context: { loading: false, entries: [{ kind: 'tool', name: 'bash', text: 'npm test' }], truncated: true, dropped: 2, chars: 8 },
  })
  assert.equal(JSON.stringify(withContext).includes('npm test'), true)
  assert.equal(JSON.stringify(withContext).includes('context.truncated'), true)
})
