# 失败台账查询接口（dsh-failure-ledger）设计稿

日期：2026-11-22　状态：已批准
作者：lead（与用户共同澄清）

## 1. 意图与为什么

用户要三种能被其他插件和面板本身调用的查询能力，并已在对话中选定做法：

1. **失败上下文**：给定一次失败，返回失败所在 turn 的会话日志——出错工具/脚本的入参原文要完整保留，前面模型做了什么也要能看到。实现在 `getFailureContext` 里，不拖累列表轮询。
2. **基线忽略**：某组错误可以设一个时间基线，基线之前的失败不再计入该组；修好且没有新失败时整组消失，回归后以新次数重新出现，用来追踪改进。用户已确认「从基线后重新累计」。
3. **逐条明细**：某组失败的每条详情。台账里早已存了 `turn`、`step`、`exitCode`、`signal`、`timeoutMs`、`errorCode`，只是 `getGroup` 的投影没带出来。

面板做最小接线：行内多一个「从此刻起忽略」，明细里每条失败多一个「查看上下文」。

## 2. 目标 / 非目标 / 反目标

**目标**
- `getFailureContext({ sessionId, seq, maxChars? })` 返回失败所在 turn 的归一化日志：从最近的 `turn/start` 到失败事件（含），总字符受上限约束，超出时丢弃最旧的条目并标记。
- 失败工具调用的 `arguments` 原文完整保留（不截断、不转义改写），调用方可直接读命令/脚本。
- `prefs.since`（groupId → 时间戳）按组设定；基线之前的发生不计入该组的次数、会话数、`lastAt`、明细，也不计入 `totals.failures`；没有剩余发生时整组不出现。
- `updatePrefs` 接受 `since` / `unsince` 补丁；取消基线后旧失败重新计入。
- `getGroup` 的每条发生带上 `turn`、`step`、`exitCode`、`signal`、`timeoutMs`、`errorCode`。
- 三个能力都经 `ctx.failureLedger` 对其他插件开放，也经 typert wire 给面板用。
- 中英文界面各一套文案，无遗留死键。

**非目标**
- 不做完整的日志浏览器（向上/向下翻页、搜索、跳转）。
- 不做基线时间的图形选择器：面板只提供「从此刻起」。
- 不设全局基线；基线总是按组。
- 不在上下文里返回图片等非文本块。
- 不持久化面板展开状态。

**反目标**（做了就算失败）
- 每次 `getLedger` 轮询都读会话日志，把面板拖慢。
- 基线破坏性改写台账（删掉旧失败，取消后无法恢复）。
- 次数、明细、总数三者口径不一致（比如次数已重置、总数仍含旧失败）。
- 上下文静默截断而不告知调用方。

## 3. 约束

- 宿主已有 `sessionQuery.readSession(sessionId)`（完整事件），service 需由 `index.js` 注入 `readSession`；扫描器已有的 `source.readSession` 不直接复用，避免 service 依赖扫描器。
- 客户端是无打包器的手写 `React.createElement` 单文件 bundle：改 `src/client/*.js` 后必须跑 `node scripts/build-client.js` 重新生成 `lib/client.js` 并提交。
- wire 走 typert strict codec：新方法必须同时出现在 `lib/schemas.js` 的 `SCHEMAS`、`typert.js` 的 `TYPERT.invocations` / `model.services`、`src/client/01-core.js` 的 `CONTRIBUTION`，四者名字一致。
- 面板每 5 秒轮询 `getLedger`；上下文只在点击时取一次，不进入轮询。
- 台账文件向后兼容：旧文件没有 `prefs.since`，启动时必须补成 `{}`，`SCHEMA_VERSION` 不变。

## 4. 设计

### 4.1 `getFailureContext`

入参一个对象：`{ sessionId: string, seq: number, maxChars?: number }`。

步骤：
1. `readSession(sessionId)` 取完整事件；找不到 `sessionId` 时返回 `{ found: false, ... }`，不抛。
2. 定位 `events[i].seq === seq` 的失败事件；找不到同样 `found: false`。
3. 从 `i` 向前找最近的 `turn/start` 作为起点；没有则从 0 开始。
4. 按顺序把起点到 `i`（含）的事件归一化成条目（下表），无法识别的类型跳过。
5. 追加一条 `{ kind: 'failure', text: line, name: tool }`（数据取自台账里同 session 同 seq 的失败记录）。
6. 计算条目文本总字符数 `chars`；超过 `maxChars` 时从最旧条目开始丢，直到不超限，记 `dropped` 条与 `truncated: true`。失败条目永不丢弃。

归一化：

| 事件 | 条目 |
|---|---|
| `turn/start` | `{ kind: 'turn', text: 'turn <n>' }` |
| `user/message` | `{ kind: 'user', text: flattenContent(data.content) }` |
| `assistant/message` | `{ kind: 'assistant', text: flattenContent(data.message.content) }` |
| `tool/call` | `{ kind: 'tool', name: data.name, callId: data.callId, text: data.arguments }` |
| `tool/result` | `{ kind: 'result', name: 工具名, callId, isError: data.message.isError === true, text: flattenContent(data.message.content) }` |
| `job/settled` | `{ kind: 'job', text: data.detail ?? data.label ?? data.status }` |
| `tool/ptc-dispatch` | `{ kind: 'ptc', name: data.name, isError: data.isError === true, text: flattenContent(data.content) }` |

返回：

```
{ found, sessionId, sessionTitle, seq, turn, tool, kind, signature, line,
  entries: [{ kind, text, name?, callId?, isError? }], chars, truncated, dropped }
```

`maxChars` 默认取新配置 `contextMaxChars`（20000），每次调用取 `min(请求值, 配置值)`；`contextMaxChars` 是 `cordis.yml` 字段，整数 `[1000, 200000]`。

### 4.2 基线忽略

存储：`prefs.since = { [groupId]: number }`（epoch ms）。`prefs.ignored` 继续表示整组静音，两者互不替代。

生效口径：
- 一条发生的有效组 = `prefs.merge[groupId] ?? groupId`（合并后的组才算「该组」）。
- 若 `since[有效组]` 存在且 `occurrence.at <= since[有效组]`，这条发生被剔除：不计入分组、`getGroup` 明细、`totals.failures`。
- 剔除后组内没有剩余发生时，该组不出现。
- `totals.failures` 因此从基线后重新计数；`unknownOutcome`、`scanErrors`、`sessions` 口径不变。
- 剔除只发生在读取时，台账里的失败记录保持原样；`unsince` 立即恢复计数。

补丁：`PrefsPatch` 增加
- `since: [{ groupId: string, before: number }]`
- `unsince: [groupId: string]`

校验：`groupId` 非空字符串；`before` 有限正数；组不存在也允许设置（该组可能暂时没有新失败）。返回值里的 `prefs` 带上 `since`。

### 4.3 `getGroup` 明细

每条 occurrence 增加 `turn`、`step`、`exitCode`、`signal`、`timeoutMs`、`errorCode`（存在才带，和存储一致）。`seq` 已有，调用方据此取上下文。

### 4.4 面板接线

- 行内动作：未忽略的组多一个链接「从此刻起忽略」→ `updatePrefs({ since: [{ groupId, before: Date.now() }] })`；整组忽略/取消的逻辑不变。
- 明细：每条失败多一个「查看上下文」链接 → `getFailureContext({ sessionId, seq })`，在明细里按条目顺序渲染（角色/工具名一行，正文等宽块），带加载中、失败、已截断（丢弃 n 条）三种提示。
- 新 locale 键：`action.baseline`、`action.context`、`context.loading`、`context.failed`、`context.truncated`，中英各一套。
- 不做基线时间选择器，也不在列表里额外标注基线状态。

### 4.5 文档

README 增加「Querying from another plugin」小节：三个能力、对象形状、基线语义；设计稿与计划文件照常提交。

## 5. 数据与兼容

- `SCHEMA_VERSION` 保持 1；`completeLedger` 补 `prefs.since = {}`。
- wire 的 `Prefs` schema 增加可选 `since`；新 schema 名：`ContextQuery`、`ContextEntry`、`FailureContext`。
- 不新增运行时依赖。

## 6. 备选方案与被否决理由

- **B：把上下文内联进 `getGroup`**——列表轮询变重，其他插件只想拿明细也得付上下文成本，否决。
- **C：上下文返回原始事件**——灵活，但每个调用方都要懂 DSH 事件格式与 turn 语义，否决；归一化条目更便宜。
- **基线改写 `ignored` 成对象数组**——旧文件迁移复杂、整组静音与基线混在一起，否决；独立 `since` 字段更清楚。
- **基线存到另一个文件**——同一份用户决定分裂在两个文件，恢复与备份变复杂，否决。

## 7. 测试计划

- `test/service.test.js`：基线 5 条（剔除旧发生、计数与总数重置、整组消失、无基线不受影响、合并组按目标组基线生效）；`getGroup` 明细字段；`updatePrefs` 的 since/unsince 与非法输入。
- `test/context.test.js`：turn 边界、条目归一化（含入参原文完整）、丢弃最旧与 `truncated/dropped`、`found:false` 两种、`maxChars` 下限与配置上限。
- `test/wire-roundtrip.test.js`：`ContextQuery`/`FailureContext` 接受与拒绝；`PrefsPatch` 的 since/unsince。
- `test/header-sort.test.js` 或新客户端测试：明细的「查看上下文」按钮回调、上下文条目渲染、截断提示（vm + 假 React）。
- 全量 `npm test`、`npm run build` 后 `git diff --exit-code lib/client.js`；重启宿主后用 `/tmp/cdp.mjs` 在真实面板点一次「查看上下文」与「从此刻起忽略」。

## 8. 开放问题

无：上下文深度（整段 turn）、基线的计数口径（重新累计）、UI 范围（最小接线）均已在对话中确定。
