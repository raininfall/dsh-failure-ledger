# 失败台账表头排序（dsh-failure-ledger）设计稿

日期：2026-11-22　状态：待用户批准
作者：lead（与用户共同澄清）

## 1. 意图与为什么

用户要能点表头按任意列排序。现状只有一个「排序」下拉，两项（按次数、按最近），且表头不可点：想按工具名或会话数看一眼"哪类失败铺得最广"就做不到。

位置：排序在宿主完成（`lib/service.js:183-185`），随后按 `DEFAULT_GROUP_LIMIT = 100` 截断（`lib/service.js:7,188`）。这个先后顺序决定了方案。

## 2. 目标 / 非目标 / 反目标

**目标**
- 六个数据列（次数、工具、类型、签名、最后出现、会话数）都能点表头排序；再点同一列切换升降序。
- 排序作用于截断前的完整分组集，超过 100 组时顺序仍然正确。
- 表头按钮键盘可达，`aria-sort` 反映当前列与方向。
- 中英文界面各一套文案，无遗留的死文案键。

**非目标**
- 不做多列复合排序（点第二列不成为次级键）。
- 不改明细面板的按时间倒序。
- 不持久化排序偏好（与现有下拉一致：面板卸载即回默认）。
- 不加列显示/隐藏。

**反目标**（做了就算失败）
- 排序结果依赖扫描顺序或分组插入顺序。
- 分组超过 100 时"按工具排序"只排了宿主先按次数取的前 100 行。
- 两套排序控件（表头 + 下拉）并存、状态不一致。

## 3. 约束

- 排序必须在宿主完成：客户端只拿到 `rows.slice(0, limit)` 之后的 100 行。
- 宿主拿不到界面语言：文本列用码元序比较；类型列按 `KINDS` 的规范顺序（`lib/detect.js:7`），保证中英文下顺序一致。
- 客户端是无打包器的手写 `React.createElement` 单文件 bundle：改 `src/client/*.js` 后必须跑 `node scripts/build-client.js` 重新生成 `lib/client.js`。
- wire 两端同包发布（客户端描述符在 `src/client/01-core.js`，宿主 schema 在 `lib/schemas.js`），`sort` 形状变化不做兼容 shim；旧页面在新宿主上会因 schema 解析失败显示错误，刷新即恢复。

## 4. 方案

**A. 宿主排序（选定）**：`query.sort` 从两个枚举值扩成 `key + dir`；点表头重拉一次（面板本来每 5s 轮询）。改动集中在已有排序路径，limit 语义不变，轮询成本不随台账变大。

**B. 客户端只排返回的行**：省一次请求，但只排前 100 行，语义错误。

**C. 宿主返回全部分组、客户端排序**：点击零延迟，但每次轮询与筛选都传全量分组，且要重新定义 limit。

## 5. 已定的做法

**wire**：`LedgerQuery.sort?: { key: 'count' | 'sessionCount' | 'lastAt' | 'tool' | 'kind' | 'signature', dir: 'asc' | 'desc' }`；省略时等价于 `{ key: 'count', dir: 'desc' }`。

**比较器**：`count` / `sessionCount` / `lastAt` 数值比较；`tool` / `signature` 码元序；`kind` 按 `KINDS` 下标。每种键都以下列兜底，保证全序（结果确定、可测）：主键 → `count` 降序 → `lastAt` 降序 → `groupId` 升序。

**截断**：排序后 `slice(0, limit ?? DEFAULT_GROUP_LIMIT)`，顺序不变。

**客户端**：`sort` 从 filters 里拿出来单独成 state，形状 `{ key, dir }`，默认 `{ key: 'count', dir: 'desc' }`；`queryOf(filters, sort)` 输出 `sort`；删除下拉框与 `filter.sort`、`sort.count`、`sort.last` 三个文案键。

**表头**：六个可排序 `<th>` 带 `aria-sort="ascending" | "descending" | "none"`，内部放 `<button class="dsh-fl-sort">`（原生按钮，Tab 与 Enter/Space 可用），活动列标签后加 ↑/↓ 且 `aria-hidden`，可访问名保持列名。点活动列切换方向；点其他列用该列默认方向：数值列与最后出现降序，文本列与类型列升序。

**样式**：`.dsh-fl-sort` 去掉按钮外观、继承字体与颜色、`cursor: pointer`，补 hover 与 `:focus-visible` 提示；沿用 `dsh-fl-table th` 的 sticky 表头。

**文档**：README 面板一节补一条表头排序说明。

## 6. 留给实现者

- 比较器抽成 `compareBy(sort)` 加统一兜底；单测覆盖六个键 × 两个方向、兜底顺序，以及"先排序后截断"（limit 取全局最小的工具名，而不是次数前 100 的子集）。
- 客户端渲染测试用现有假 React 直接取树：断言六列表头是按钮、活动列 `aria-sort` 与箭头、同列再点翻方向、点新列用默认方向。
- `queryOf` 的契约测试（`test/prefs-contract.test.js`）跟随新形状。
