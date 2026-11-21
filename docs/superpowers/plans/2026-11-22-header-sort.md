# 失败台账表头排序实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让失败台账的六个数据列都能点表头排序、再点切换升降序，排序在宿主侧作用于截断前的完整分组集。

**Architecture:** `query.sort` 从两个字符串枚举改为 `{ key, dir }`；宿主在 `lib/service.js` 用统一比较器排序后再按 `DEFAULT_GROUP_LIMIT` 截断；客户端把 `sort` 从 filters 中拆成独立 state，表头渲染成 `<button>` 并带 `aria-sort`，点表头改 state → 查询键变化 → 重新拉取。

**Tech Stack:** Node 24 ESM、`node --test`、zod wire schema、手写 `React.createElement` 客户端 bundle（`scripts/build-client.js` 拼接，无打包器）。

**Spec:** `docs/superpowers/specs/2026-11-22-header-sort-design.md`

## Global Constraints

- 排序必须在 `rows.slice(0, limit ?? 100)` 之前，作用于完整分组集。
- `sort` 省略时等价于 `{ key: 'count', dir: 'desc' }`。
- `kind` 按 `lib/detect.js:7` 的 `KINDS` 顺序比较，不按本地化标签。
- 全序兜底固定为：主键 → `count` 降序 → `lastAt` 降序 → `groupId` 码元序升序。
- 文本列用码元序（`<`/`>` 比较），不用 `localeCompare`。
- 排序偏好只进组件 state，不写台账文件；删除下拉框，表头是唯一入口。
- 不做 wire 兼容 shim：旧形状 `sort: 'count'` 在新 schema 下必须解析失败。
- 改完 `src/client/*.js` 必须跑 `npm run build` 重新生成 `lib/client.js` 并一起提交。

## Review Focus

1. 分组数超过 100 时点「工具」升序：用户期望看到全局字典序最小的工具，而不是宿主先按次数取的前 100 行重排。
2. 台账里存在 `KINDS` 之外的历史 kind：用户期望老数据照常显示、不抛错，此类行排在已知 kind 之后。
3. 相同 count 且相同 lastAt 的多行：两次刷新顺序一致，不随扫描顺序漂移。
4. 键盘与读屏：表头按钮可 Tab 聚焦、Enter/Space 生效，`aria-sort` 只在当前排序列报方向。
5. 轮询（5s）或后台扫描期间点表头：排序 state 不被轮询结果重置，点击后立即按新顺序重拉。

---

### Task 1: 宿主排序比较器与 wire schema

**Files:**
- Modify: `lib/schemas.js:104-116`（`ledgerQuery` 的 `sort` 字段）
- Modify: `lib/service.js:1-8`（新增 import 与默认排序常量）、`lib/service.js:178-190`（`build()` 的排序段）
- Test: `test/service.test.js`（追加用例）、`test/wire-roundtrip.test.js`（追加 schema 用例）

**Interfaces:**
- Consumes: `KINDS`（`lib/detect.js:7`）、现有 `field(query, key)` 与 `build()`。
- Produces: `sort` 查询形状 `{ key: 'count' | 'sessionCount' | 'lastAt' | 'tool' | 'kind' | 'signature', dir: 'asc' | 'desc' }`；`compareGroups(sort)` 返回 `(left, right) => number`，供 Task 2 的查询使用。

- [ ] **Step 1: 写失败测试（宿主排序）**

在 `test/service.test.js` 追加（沿用现有 `failure/entry/makeService` helper）：

```js
test('tool and signature sort in code-unit order', async () => {
  const sessions = {
    s1: entry([
      failure(BASE - 100, 'zeta', 'exit', 'b-line'),
      failure(BASE - 200, 'alpha', 'exit', 'a-line'),
      failure(BASE - 300, 'mike', 'exit', 'c-line'),
    ]),
  }
  const { service } = makeService({ sessions })
  const asc = await service.getLedger({ sort: { key: 'tool', dir: 'asc' } })
  assert.deepEqual(asc.groups.map((group) => group.tool), ['alpha', 'mike', 'zeta'])
  const desc = await service.getLedger({ sort: { key: 'signature', dir: 'desc' } })
  assert.deepEqual(desc.groups.map((group) => group.signature), ['c-line', 'b-line', 'a-line'])
})

test('numeric columns sort both ways', async () => {
  const { service } = makeService({ sessions: THREE_AND_TWO })
  const asc = await service.getLedger({ sort: { key: 'count', dir: 'asc' } })
  assert.deepEqual(asc.groups.map((group) => group.count), [2, 3])
  const sessions = await service.getLedger({ sort: { key: 'sessionCount', dir: 'desc' } })
  assert.deepEqual(sessions.groups.map((group) => group.sessionCount), [2, 1])
})

test('kind sorts by the canonical kind order, unknown kinds last', async () => {
  const sessions = {
    s1: entry([
      failure(BASE - 100, 'bash', 'timeout', 't'),
      failure(BASE - 200, 'bash', 'exit', 'e'),
      failure(BASE - 300, 'bash', 'mystery', 'm'),
      failure(BASE - 400, 'bash', 'error', 'x'),
    ]),
  }
  const { service } = makeService({ sessions })
  const asc = await service.getLedger({ sort: { key: 'kind', dir: 'asc' } })
  assert.deepEqual(asc.groups.map((group) => group.kind), ['error', 'exit', 'timeout', 'mystery'])
})

test('equal primary keys fall back to count, lastAt, then groupId', async () => {
  const sessions = {
    s1: entry([
      failure(BASE - 100, 'bash', 'exit', 'aaa'),
      failure(BASE - 100, 'bash', 'exit', 'bbb'),
    ]),
  }
  const { service } = makeService({ sessions })
  const first = await service.getLedger({ sort: { key: 'tool', dir: 'asc' } })
  const second = await service.getLedger({ sort: { key: 'tool', dir: 'asc' } })
  assert.deepEqual(first.groups.map((group) => group.groupId), second.groups.map((group) => group.groupId))
  const ids = first.groups.map((group) => group.groupId)
  assert.deepEqual(ids, [...ids].sort())
})

test('limit applies after sorting, not before', async () => {
  const sessions = {
    s1: entry([
      failure(BASE - 100, 'zeta', 'exit', 'z'),
      failure(BASE - 101, 'zeta', 'exit', 'z'),
      failure(BASE - 102, 'zeta', 'exit', 'z'),
      failure(BASE - 200, 'mike', 'exit', 'm'),
      failure(BASE - 300, 'alpha', 'exit', 'a'),
    ]),
  }
  const { service } = makeService({ sessions })
  const top = await service.getLedger({ sort: { key: 'tool', dir: 'asc' }, limit: 2 })
  assert.deepEqual(top.groups.map((group) => group.tool), ['alpha', 'mike'])
})
```

在 `test/wire-roundtrip.test.js` 追加：

```js
test('LedgerQuery carries a key and direction and rejects the old string form', () => {
  const schema = schemaFor('LedgerQuery').create()
  assert.doesNotThrow(() => schema.parse({ sort: { key: 'kind', dir: 'asc' } }))
  assert.throws(() => schema.parse({ sort: 'count' }))
  assert.throws(() => schema.parse({ sort: { key: 'nope', dir: 'asc' } }))
  assert.throws(() => schema.parse({ sort: { key: 'count', dir: 'sideways' } }))
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/service.test.js test/wire-roundtrip.test.js`
Expected: FAIL——排序用例里 `sort` 对象被忽略（仍按次数降序），schema 用例对对象形式抛错。

- [ ] **Step 3: 实现 schema 与宿主比较器**

`lib/schemas.js` 的 `ledgerQuery` 中把 `sort: z.enum(['count', 'last']).optional()` 换成：

```js
sort: z
  .object({
    key: z.enum(['count', 'sessionCount', 'lastAt', 'tool', 'kind', 'signature']),
    dir: z.enum(['asc', 'desc']),
  })
  .optional(),
```

`lib/service.js` 顶部加 `import { KINDS } from './detect.js'` 与 `const DEFAULT_SORT = Object.freeze({ key: 'count', dir: 'desc' })`；新增 `compareText(left, right)`（码元序）、`KIND_RANK`（`KINDS` 下标表，未知 kind 记 `KINDS.length`）、`COMPARATORS`（六个键）与 `compareGroups(sort)`（应用 `dir` 符号后接全序兜底）。`build()` 的排序段替换为：

```js
const sort = field(query, 'sort') ?? DEFAULT_SORT
rows.sort(compareGroups(sort))
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/service.test.js test/wire-roundtrip.test.js`
Expected: PASS，全部既有用例也通过。

- [ ] **Step 5: 提交**

```bash
git add lib/schemas.js lib/service.js test/service.test.js test/wire-roundtrip.test.js
git commit -m "feat: sort ledger groups by any column on the host"
```

---

### Task 2: 客户端表头排序与文案

**Files:**
- Modify: `src/client/02-page.js`（`queryOf`、`Filters`、`GroupTable`、`Page`）
- Modify: `src/client/03-apply.js:29,37`（样式）
- Modify: `locale/zh.json`、`locale/en.json`（删 3 个键）
- Modify: `lib/client.js`（构建产物）
- Test: `test/header-sort.test.js`（新建）、`test/prefs-contract.test.js`（更新 `queryOf` 契约）

**Interfaces:**
- Consumes: Task 1 的 `sort` 查询形状。
- Produces: `nextSort(sort, key) -> { key, dir }`、`sortStateOf(sort, key) -> { ariaSort: 'ascending' | 'descending' | 'none', arrow: '↑' | '↓' | '' }`、`SORTABLE`（列定义）、`queryOf(filters, sort)`。

- [ ] **Step 1: 写失败测试**

新建 `test/header-sort.test.js`。加载器把两个 fragment 拼起来在 vm 里求值（沙箱提供假 `React.createElement`，与 `test/prefs-contract.test.js:107-110` 同一手法）：

```js
function load() {
  const CORE = readFileSync(new URL('../src/client/01-core.js', import.meta.url), 'utf8')
  const PAGE = readFileSync(new URL('../src/client/02-page.js', import.meta.url), 'utf8')
  const sandbox = {
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    console,
  }
  return vm.runInNewContext(`${CORE}\n${PAGE}\n({ nextSort, sortStateOf, queryOf, GroupTable })`, sandbox)
}
```

然后断言：

```js
test('clicking the active column flips direction, another column uses its default', () => {
  assert.deepEqual(load().nextSort({ key: 'count', dir: 'desc' }, 'count'), { key: 'count', dir: 'asc' })
  assert.deepEqual(load().nextSort({ key: 'count', dir: 'desc' }, 'tool'), { key: 'tool', dir: 'asc' })
  assert.deepEqual(load().nextSort({ key: 'tool', dir: 'asc' }, 'lastAt'), { key: 'lastAt', dir: 'desc' })
  assert.deepEqual(load().nextSort({ key: 'tool', dir: 'asc' }, 'sessionCount'), { key: 'sessionCount', dir: 'desc' })
})

test('aria-sort reports only the active column and its direction', () => {
  const { sortStateOf } = load()
  assert.deepEqual(sortStateOf({ key: 'signature', dir: 'desc' }, 'signature'), { ariaSort: 'descending', arrow: '↓' })
  assert.deepEqual(sortStateOf({ key: 'signature', dir: 'asc' }, 'signature'), { ariaSort: 'ascending', arrow: '↑' })
  assert.deepEqual(sortStateOf({ key: 'signature', dir: 'asc' }, 'tool'), { ariaSort: 'none', arrow: '' })
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
```

`test/prefs-contract.test.js` 的两处 `queryOf(...)` 改为传第二参：默认 `{ key: 'count', dir: 'desc' }`，另一处 `{ key: 'lastAt', dir: 'desc' }`，期望对象里的 `sort` 相应变成对象。另加一条源码契约：

```js
test('the initial sort is count descending and filters no longer carry it', () => {
  assert.match(SOURCE, /useState\(\{ key: 'count', dir: 'desc' \}\)/)
  assert.doesNotMatch(SOURCE, /hideIgnored: true, sort:/)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/header-sort.test.js test/prefs-contract.test.js`
Expected: FAIL——`nextSort`/`sortStateOf` 未定义，表头仍是纯文本，`queryOf` 仍输出字符串 `sort`。

- [ ] **Step 3: 实现客户端**

`src/client/02-page.js`：

- `queryOf(filters, sort)` 输出 `{ hideIgnored, sort, ... }`。
- 新增 `defaultDirection(key)`、`nextSort(sort, key)`、`sortStateOf(sort, key)`、`SORTABLE`（`[{ key: 'count', label: 'column.count' }, { key: 'tool', label: 'column.tool' }, { key: 'kind', label: 'column.kind' }, { key: 'signature', label: 'column.signature' }, { key: 'lastAt', label: 'column.lastAt' }, { key: 'sessionCount', label: 'column.sessions' }]`）。
- `Filters` 删除 `<select>` 整块（保留两个输入框、kind chips、两个 checkbox）。
- `GroupTable` 的 `<thead>` 改为：选择列与操作列原样，六个数据列由 `SORTABLE` 生成 `<th scope="col" aria-sort={...}>`，内含 `<button type="button" className="dsh-fl-sort" onClick={() => props.onSort(column.key)}>` + 标签 + 活动列的方向 `<span className="dsh-fl-arrow" aria-hidden="true">`。
- `Page`：filters state 去掉 `sort`；新增 `const [sort, setSort] = React.useState({ key: 'count', dir: 'desc' })`；`useLedger(service, queryOf(filters, sort))`；`GroupTable` 传 `sort` 与 `onSort={(key) => setSort(nextSort(sort, key))}`。

`src/client/03-apply.js`：`.dsh-fl-input,.dsh-fl-select` 改为 `.dsh-fl-input`；在 `.dsh-fl-table th` 之后加三条样式（按钮去外观、hover、focus-visible）与 `.dsh-fl-arrow{font-size:10px;color:var(--dsw-alias-label-tertiary,#8b9099)}`。

`locale/zh.json` 与 `locale/en.json`：删除 `filter.sort`、`sort.count`、`sort.last`。

- [ ] **Step 4: 重新生成 bundle 并跑测试**

Run: `npm run build && node --test test/header-sort.test.js test/prefs-contract.test.js test/client-contribution.test.js test/client-bundle.test.js`
Expected: PASS；`lib/client.js` 里出现 `dsh-fl-sort`。

- [ ] **Step 5: 提交**

```bash
git add src/client/02-page.js src/client/03-apply.js locale/zh.json locale/en.json lib/client.js test/header-sort.test.js test/prefs-contract.test.js
git commit -m "feat: sort the ledger by clicking a column header"
```

---

### Task 3: 文档与整体验证

**Files:**
- Modify: `README.md`（Panel 一节）
- Test: 全量 `npm test`

**Interfaces:**
- Consumes: Task 1、Task 2 的最终行为。
- Produces: 无新接口。

- [ ] **Step 1: 更新 README**

Panel 一节的过滤列表后补一条：「Click any data column header to sort by it; click the same header again to reverse the direction. Sort order is not saved across reloads.」

- [ ] **Step 2: 跑全量测试**

Run: `npm test`
Expected: 全部通过，无 skip 的新用例。

- [ ] **Step 3: 确认构建产物与源码一致**

Run: `npm run build && git diff --exit-code lib/client.js`
Expected: 退出码 0（已提交的 `lib/client.js` 就是当前源码的产物）。

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs: describe header sorting in the ledger panel"
```
