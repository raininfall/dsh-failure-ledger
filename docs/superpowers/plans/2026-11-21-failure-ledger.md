# Failure Ledger 实现计划

> 执行方式：本计划分 11 个任务，任务之间有硬依赖（后面的任务 `Consumes` 前面的 `Produces`）。可以按 `superpowers:subagent-driven-development` 每个任务派一个新 subagent，也可以按 `superpowers:executing-plans` 在本会话里逐个执行。两种方式都要求：单任务内先写失败测试、再实现、再跑通、再提交；任务完成即 `git status` 干净。

**Goal:** 做一个 DSH Web 插件，把 `~/.dsh/sessions` 里每一条工具/脚本失败折叠成确定性分组（同工具 + 同失败类别 + 同归一化错误行 = 一组），在侧栏台账页里按组呈现原始出现次数，不调用任何模型。

**Architecture:** 宿主侧一个 Cordis 插件（`apply(ctx)`）从 `ctx.sessionQuery` 读会话日志、按文件指纹增量重扫、把失败记录写进一个 JSON 台账文件；同进程内用 `ctx.provide('failureLedger', ...)` 暴露服务，`./typert` 导出 RPC 清单供客户端调用。客户端是一个哈希注入的 React 页面，注册为 `main` 的 keyed 面板 + `sidebar.panellist` 条目，只做展示/筛选/静音/合并，不发模型请求、不生成报告文本。

**Tech Stack:** Node 24 ESM、`node:test`、`node:crypto`（sha1）、`zod` 4.6.6（仅宿主 RPC schema）、React 18（客户端经 `require('react')`）、`@deepseek-ai/dsh-home-paths`（peer）、无构建器（客户端用 `scripts/build-client.js` 拼接 + `node --check`）。

**Spec:** [2026-11-21-failure-ledger-design.md](../specs/2026-11-21-failure-ledger-design.md)

## Global Constraints

- 包根 `/Users/rain/lab/dsh-failure-ledger`，独立包，不进 DeepSeek Harness 主仓库。
- 全 ESM：`"type": "module"`；`engines.node >= 24.9.0`；导入本地文件必须带 `.js` 后缀。
- **零模型调用、零网络请求**。相同输入必须产生相同输出（同 `groupId`），任何步骤都不得引入时间无关性之外的随机源。
- 七个失败类别固定为 `error`、`exit`、`signal`、`timeout`、`job-failed`、`job-killed`、`ptc-error`，不得增删。
- `groupId = sha1(tool + '\0' + kind + '\0' + signature).slice(0, 16)`（小写十六进制）。
- 签名上限 160 字符（`maxSignatureChars` 默认 160），`line`（原始行）上限 400 字符。
- 台账文件 `$DSH_HOME/storages/failure-ledger/ledger.json`；写入一律 `写 <path>.tmp-<pid> → rename` 原子替换。
- `schemaVersion = 1`、`rulesVersion = 1`；两者语义不同，前者格式门禁，后者只是偏好失效提示的依据。
- 默认保留窗口 `retentionDays = 90`，按失败自身的 `at`（事件 `time`）计算，不按会话创建时间。
- 失败判定只信两类事实：事件里的 `isError`/`status`/`detail` 字段，以及渲染文本里的标记行（`[exit code: N]`、`[killed by signal: X]`、`[timed out after Nms]`、`[stopped: ...]`）。
- RPC 共 4 个方法，参数个数固定；客户端声明几个参数就必须传几个（DSH 校验实参个数）。
- 保留窗口、并发、子会话、PTC 全部走 Config，不写死；配置非法在 `apply` 阶段抛错（fail loud）。
- UI 文案全部走 `locale/zh.json` + `locale/en.json`，组件内不得硬编码中文或英文句子。
- 面板 id 固定 `failure-ledger`；`main` 面板用 keyed 注册，侧栏条目用 `sidebar.panellist`。
- 运行时依赖只允许 `zod@4.6.6`；peer 只允许 `@deepseek-ai/dsh-home-paths`；不得新增其他依赖。
- 测试只用 `node --test` + `node:test` + `node:assert/strict`，不引测试框架；`npm test` = `node --test`。
- 每任务一个 commit，标题 `feat(failure-ledger): <动词短语>`，正文说明为什么。

## Review Focus

| # | 最可能咬人的输入/失败模式 | 落在哪个任务的测试 |
| --- | --- | --- |
| 1 | 单条 `tool/result` 的正文字段可能是空串，也可能是数 MB 的构建日志；签名与截断必须都不抛错，且不得把整段正文写进台账。 | Task 2 `signature.test.js`（空串/2MB 输入/无换行长行）与 Task 3 `detect.test.js`（`line` 截断到 400） |
| 2 | `readSession` 或 `stat` 对某个会话抛错/返回残缺数据时，整轮扫描不能停，且错误本身要让用户看见。 | Task 5 `scanner.test.js`（`scanError` 落盘、后续会话继续）与 Task 9（顶部提示条） |
| 3 | fork 出来的会话快照带父会话的继承前缀（`inheritedEventCount > 0`），照单全收会把父会话的失败重复计入。 | Task 3 `detect.test.js`（`seq < inheritedEventCount` 的事件必须被跳过） |
| 4 | 保留窗口的边界与时钟：失败时间取事件 `time`（epoch ms），窗口按毫秒差算，不按本地日历日；跨时区/夏令时不得改变分组结果。 | Task 3 `detect.test.js`（`nowMs` 边界 ±1ms）与 Task 5 `scanner.test.js`（淘汰后计数下降） |
| 5 | 偏好引用的组在保留窗口淘汰后消失：静音表/合并表里还留着旧 `groupId`，不能崩、不能造出幽灵组、要能提示。 | Task 6 `service.test.js`（失效合并目标被忽略并出现在 `notices`）与 Task 9（提示条渲染） |

## File Structure

```
/Users/rain/lab/dsh-failure-ledger/
  package.json              # exports "." "./client" "./typert"、dsh.bundle.patch、dsh.client
  cordis.patch.yml          # insert 一行 failure-ledger
  index.js                  # 插件入口：apply(ctx, rawConfig)
  lib/config.js             # CONFIG_DEFAULTS + normalizeConfig
  lib/signature.js          # 纯函数：错误行抽取、归一化、groupId
  lib/detect.js             # 纯函数：事件流 → 失败记录
  lib/ledger-store.js       # 单 JSON 台账：打开/校验/原子保存/损坏恢复
  lib/scanner.js            # 指纹增量扫描 + 并发 + scanError
  lib/service.js            # 分组聚合、筛选、静音、合并、totals
  lib/schemas.js            # zod RPC 契约（宿主）
  typert.js                 # TYPERT 清单（host face）
  src/client/01-core.js     # 面板 id、codecOf/strictCodec、格式化、状态钩子
  src/client/02-page.js     # 页面组件：totals、筛选、分组列表、明细、提示条
  src/client/03-apply.js    # apply/inject：$mount、槽位注册、CSS 注入
  scripts/build-client.js   # 拼接 01..03 → lib/client.js（加严格包裹头）
  locale/zh.json  locale/en.json
  test/*.test.js
  README.md
```

---

### Task 1: 包骨架、配置校验与可安装的空插件

**Files**
- Create: `package.json`, `cordis.patch.yml`, `index.js`, `lib/config.js`, `README.md`, `.gitignore`
- Test: `test/config.test.js`, `test/packaging.test.js`

**Interfaces**
- Consumes: 无。
- Produces: `CONFIG_DEFAULTS`、`normalizeConfig(raw) → FrozenConfig`；`package.json` 的 `exports`/`dsh.bundle.patch`；`cordis.patch.yml` 的一行 insert。

**Steps**
- [ ] `git init`、`.gitignore`（`node_modules/`、`*.tmp-*`）；写 `package.json`：
  - `"name": "dsh-failure-ledger"`、`"version": "0.1.0"`、`"private": true`、`"type": "module"`、`"engines": { "node": ">=24.9.0" }`
  - `"exports": { ".": { "default": "./index.js" } }`（`./client`、`./typert`、`./package.json`、`./locale/*.json` 在 Task 7/8 补）
  - `"scripts": { "test": "node --test", "build": "node scripts/build-client.js" }`
  - `"dependencies": { "zod": "4.6.6" }`；`"peerDependencies": { "@deepseek-ai/dsh-home-paths": ">=0.2.0-rc.1 <0.3.0-0 || >=0.2.1-0 <0.3.0-0 || >=0.2.2-0 <0.3.0-0" }`
  - `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`
- [ ] 写 `test/config.test.js`：`normalizeConfig({})` 得到 `retentionDays 90 / scanOnStartup true / scanConcurrency 4 / includeSubagents true / includePtcDispatch true / ignorePatterns [] / maxSignatureChars 160`、`ledgerPath undefined`；`retentionDays: 0`、`scanConcurrency: 0`、`ignorePatterns: ['(']`（非法正则）、`ledgerPath: 'rel/x.json'`（非绝对路径）分别抛 `/failure-ledger: /` 前缀的错误；未知键被忽略不报错。先跑 `node --test test/config.test.js` 确认失败。
- [ ] 实现 `lib/config.js`：数字用 `Number.isInteger` 范围校验（`retentionDays` 1–3650、`scanConcurrency` 1–16、`maxSignatureChars` 40–400），`ignorePatterns` 逐条 `new RegExp(v)` 试编译，非法即时抛错；返回 `Object.freeze` 的配置。
- [ ] 跑 `node --test test/config.test.js` 确认通过。
- [ ] 写 `cordis.patch.yml`（一行 insert，id 固定 `failure-ledger`），与 `test/packaging.test.js`：断言 `JSON.parse(readFile('package.json')).dsh.bundle.patch === './cordis.patch.yml'`、`exports['.']` 存在、`cordis.patch.yml` 文本含 `id: failure-ledger` 与 `name: dsh-failure-ledger`。
- [ ] 实现 `index.js`：`export const name = 'failure-ledger'`、`export const inject = ['sessionQuery', 'sessionPersistence']`、`export async function apply(ctx, rawConfig) { normalizeConfig(rawConfig) }`（此任务先只校验配置，不接线）。
- [ ] 跑 `npm test` 确认全绿；`git add -A && git commit -m "feat(failure-ledger): scaffold installable plugin package"`。
- [ ] 用 `plugin_manager install_bundle`（target 为包目录路径）安装，确认 profile 的 `cordis.yml` 出现该条目、DSH 能正常启动。

---

### Task 2: 错误行抽取与归一化签名

**Files**
- Create: `lib/signature.js`
- Test: `test/signature.test.js`

**Interfaces**
- Consumes: 无（纯函数）。
- Produces:
  - `RULES_VERSION = 1`
  - `extractErrorLine(text) → string`（原始行，未归一化，`''` 表示没有可用行）
  - `normalizeLine(line, { maxChars = 160 } = {}) → string`
  - `signatureOf(content, { maxChars = 160 } = {}) → string`
  - `groupIdOf(tool, kind, signature) → string`（16 位小写十六进制）

**抽取规则（顺序固定）**
1. 若文本含 `[stderr]` 段：取该段之后的行序列。
2. 在候选行里跳过空行、退出标记行（`/^\[(exit code|killed by signal|timed out after|stopped)/`）、`^\[rtk\] ran:` 回显、以及不含任何字母或数字的行（剔除 `===`、`}` 这类噪声）。
3. 优先返回第一条命中 `/error|exception|failed|failure|not found|denied|refused|invalid|cannot|could not|no such|unable|missing/i` 的行。
4. 否则返回候选行里的第一条；若 `[stderr]` 段为空，退回到最后一个候选行（去标记后）。
5. 全无候选返回 `''`。

**归一化规则（顺序固定）**：去 ANSI（`\u001b\[[0-9;]*m`）→ Unix 绝对路径 `/\/(?:[^\s/'"]+\/)+[^\s'":]+/g` 与 Windows 盘符路径 `/[A-Za-z]:\\[^\s"']*/g` 换 `<path>` → 长度 ≥8 的十六进制串换 `<id>` → 所有数字串换 `<n>`（`行:列` 自然变成 `<n>:<n>`）→ 空白折叠为单空格 → `trim` → 截到 `maxChars`。

**Steps**
- [ ] 写 `test/signature.test.js`，断言：
  - `signatureOf('Error: BLOCKED by CC Safety Net\nReason: Command could not be safely analyzed (strict mode).\nRule: analysis.strict-unparseable')` === `'Error: BLOCKED by CC Safety Net'`
  - `signatureOf('[rtk] ran: cat foo\n[stderr]\nbash: zstdcat: command not found\n[exit code: 127]')` === `'bash: zstdcat: command not found'`
  - `signatureOf('[stderr]\n===\n}\nactual: broke here\n[exit code: 1]')` === `'actual: broke here'`（噪声行被跳过）
  - `signatureOf('')` === `''`；`signatureOf(undefined)` === `''`
  - 2MB 纯文本（无换行）不抛错且结果长度 ≤ 160
  - `normalizeLine('  /Users/rain/x/y.txt:42:7  ')` === `'<path>:<n>:<n>'`；`normalizeLine('\u001b[31mboom\u001b[0m')` === `'boom'`；`normalizeLine('C:\\Users\\rain\\a.ts failed')` === `'<path> failed'`；12 位 hex → `'<id>'`
  - `groupIdOf('bash','exit','x')` 长度 16、全 `[0-9a-f]`、同参数稳定、改任一参数必变
  - 先跑确认失败。
- [ ] 实现 `lib/signature.js`（只用 `node:crypto`）。
- [ ] 跑 `node --test test/signature.test.js` 确认通过；`git commit`。

---

### Task 3: 事件流 → 失败记录（检测器）

**Files**
- Create: `lib/detect.js`
- Test: `test/detect.test.js`

**Interfaces**
- Consumes: `signatureOf`、`normalizeLine`、`RULES_VERSION`（来自 `lib/signature.js`）。
- Produces:
  - `KINDS = ['error','exit','signal','timeout','job-failed','job-killed','ptc-error']`
  - `flattenContent(content) → string`
  - `readMarkers(text) → { exitCode?, signal?, timeoutMs?, stopped?: true }`
  - `foldSession(input) → { failures: Failure[], unknownOutcome: number }`，
    `input = { session, inheritedEventCount, events, retentionDays, nowMs?, includePtcDispatch?, maxSignatureChars?, ignorePatterns? }`
  - `Failure = { at, turn, step, seq, tool, kind, exitCode?, signal?, timeoutMs?, errorCode?, signature, line, callId? }`

**判定规则（优先级从高到低，一个事件最多产出一条失败）**
1. `tool/result` 且 `message.isError === true`：正文含 `[timed out after (\d+)ms]` → `timeout`；含 `[killed by signal: (\w+)]` → `signal`；否则 `error`（`errorCode = data.error?.code ?? data.error?.name`）。
2. 否则 `tool/result` 且 `readMarkers` 给出 `exitCode > 0` → `exit`。
3. `job/settled`：`status === 'failed'` → `job-failed`；`status === 'killed'` → `job-killed`；`status === 'completed'` 且 `detail` 匹配 `/^exit code: (\d+)$/` 且 N≠0 → `job-failed`（`exitCode = N`）；匹配 `/^signal: (\w+)(?:; (.*))?$/` → `job-killed`（`signal`、尾段进签名源）。
4. `tool/ptc-dispatch` 且结果部分 `isError === true`（`includePtcDispatch`）→ `ptc-error`。
5. `status === 'failed'` 但没有可解析 `detail` → 计入 `unknownOutcome`，不产出记录。

工具名：`tool/result` 用 `tool/call` 的 `callId → name` 映射（映射缺失时用 `?`）；`job/settled` 用 `data.toolCall` 对应的调用名，无 `toolCall` 时用 `'job'`；`tool/ptc-dispatch` 用 `data.name`。
跳过：`session.origin === 'subagent'` 的过滤由 scanner 负责；`event.seq < inheritedEventCount` 一律跳过；`at < nowMs - retentionDays*86400000` 的记录丢弃；`ignorePatterns` 命中的 `signature` 丢弃。

**Steps**
- [ ] 写 `test/detect.test.js`（自造事件对象，不读磁盘），断言：
  - isError + `error.reason` → `kind 'error'`、`errorCode`
  - `[stderr]\nboom\n[exit code: 3]` → `kind 'exit'`、`exitCode 3`
  - `[timed out after 60000ms]` → `kind 'timeout'`、`timeoutMs 60000`
  - `[killed by signal: SIGKILL]` → `kind 'signal'`、`signal 'SIGKILL'`
  - `job/settled` `completed` + `exit code: 0` → 零记录；`exit code: 3` → 一条 `job-failed`；`killed` + `signal: SIGTERM; Download stalled` → `job-killed`；无 `toolCall` → `tool 'job'`
  - `status: 'failed'` 且 `detail: 'max-tokens'` → `unknownOutcome 1`、零记录
  - `inheritedEventCount = 5` 时前 5 条事件里的失败不出现
  - `retentionDays = 90`：`at = nowMs - 90d` 保留、`at = nowMs - 90d - 1` 丢弃
  - `line` 长度 ≤ 400、`signature` ≤ 160
- [ ] 跑确认失败；实现 `lib/detect.js`；跑确认通过；`git commit`。

---

### Task 4: 单 JSON 台账存储（原子写 + 损坏恢复）

**Files**
- Create: `lib/ledger-store.js`
- Test: `test/ledger-store.test.js`

**Interfaces**
- Consumes: 无。
- Produces: `SCHEMA_VERSION = 1`、`emptyLedger({ bootId, rulesVersion }) → LedgerData`、`openLedger(path, { bootId, rulesVersion }) → Promise<{ path, data, save(), isDirty() }>`。
- `LedgerData = { schemaVersion, rulesVersion, revision, bootId, updatedAt, lastScanAt, recoveredCorrupt?, prefs: { ignored: string[], merge: Record<string, string> }, sessions: Record<sid, SessionEntry> }`
- `SessionEntry = { fingerprint: { eventCount?, sizeBytes?, revision? }, scannedAt, cwd, title, inheritedEventCount, failures, scanError? }`

**Steps**
- [ ] 写 `test/ledger-store.test.js`（`mkdtemp` 临时目录），断言：
  - 不存在的路径 → 空台账，`schemaVersion 1`、`revision 0`
  - `save()` 两次 → 文件里 `revision` 单调 +1，且目录里没有残留 `*.tmp-*`
  - 文件内容被写成 `{`（损坏）→ 打开后得到空台账，`recoveredCorrupt` 有 `from`/`at`，且原文件被重命名保留
  - `schemaVersion: 2` → `openLedger` reject，message 含 `schemaVersion 2 is newer`
  - 缺 `prefs`/`sessions` 字段的旧文件 → 补成默认值，不抛错
- [ ] 跑确认失败；实现（`writeFileSync(tmp)` + `renameSync(tmp, path)`，`mkdirSync(dirname, { recursive: true })`）；跑确认通过；`git commit`。

---

### Task 5: 指纹增量扫描器

**Files**
- Create: `lib/scanner.js`
- Test: `test/scanner.test.js`

**Interfaces**
- Consumes: `foldSession`（Task 3）、`store`（Task 4）、`normalizeConfig` 产物（Task 1）。
- Produces: `createScanner({ source, store, config, bootId, now?, onProgress? }) → Scanner`，
  `Scanner = { run({ full = false, signal } = {}), checkStale({ maxStats = 400, signal } = {}), status(), schedule({ delayMs = 3000 }) }`，
  `source = { listSessions(signal), stat(id), readSession(id, signal), readTitle(id, signal) }`，
  `run()` 返回 `{ scanned, skipped, failed, failures, durationMs }`。

**脏判定**：`full` → 必扫；无 `sessionEntry` → 必扫；否则比较 `fingerprint`：同一 `bootId` 且 `stored.fingerprint.revision === stat.revision` → 干净（快路径）；否则若 `eventCount`/`sizeBytes` 与存的一致 → 干净；任何一方缺失 → 必扫。

**Steps**
- [ ] 写 `test/scanner.test.js`（假 source，事件对象内联），断言：
  - 首轮：3 个会话全扫，`run().scanned === 3`，`store.data.sessions` 有 3 项
  - 第二轮指纹不变：`scanned === 0`、`skipped === 3`
  - 改一个会话的 `eventCount`：只重扫它（`scanned === 1`）
  - `stat` 抛错的会话：记 `scanError.message`，`failed === 1`，其余会话照常落库
  - `includeSubagents: false` 时 `header.origin === 'subagent'` 的会话不扫
  - 保留窗口淘汰：把 `nowMs` 推后 91 天后再跑，旧失败被清掉且 `failures` 计数归零
  - `onProgress` 至少被调用一次且末次 `done === total`
  - `checkStale()`：指纹变化后返回 `true` 并把该会话排进下一轮；指纹无变化返回 `false`
  - `schedule({ delayMs: 0 })` 连续调用三次只触发一次 `run`（合并触发）
- [ ] 跑确认失败；实现（`scanConcurrency` 并发池、单会话 try/catch、`store.save()` 收敛写入）；跑确认通过；`git commit`。

---

### Task 6: 分组聚合与偏好

**Files**
- Create: `lib/service.js`
- Test: `test/service.test.js`

**Interfaces**
- Consumes: `store`（Task 4）、`scanner`（Task 5）、`groupIdOf`（Task 2）、`normalizeConfig` 产物。
- Produces: `createService({ store, scanner, config, now? }) → Service`，
  `Service = { getLedger(query, knownRevision), getGroup(groupId, limit), refresh(full), updatePrefs(patch) }`；
  `getLedger → { revision, scanning, totals, groups, prefs, notices }`；
  `GroupRow = { groupId, tool, kind, signature, count, sessionCount, lastAt, ignored, mergedFrom? }`；
  `Occurrence = { at, sessionId, sessionTitle, cwd, seq, tool, kind, line, callId? }`；
  `query = { from?, to?, tool?, kinds?, sessionId?, cwd?, text?, includeJobKilled?, hideIgnored?, sort?, limit? }`（全部可选、`null`/`undefined` 等价于不筛选）。

**Steps**
- [ ] 写 `test/service.test.js`，断言：
  - 同 `tool/kind/signature` 的三条失败 + 另一组两条 → `groups` 长度 2、`count` 分别 3/2、默认按 `count` 降序
  - `sessionCount` 按不同会话去重计数
  - `hideIgnored: true` 过滤掉 `prefs.ignored` 里的组；`hideIgnored: false` 时该组 `ignored: true`
  - `prefs.merge: { a: b }` 后 `a` 组折叠进 `b`：`b.count` 相加、`b.mergedFrom` 含 `a`、结果里不再出现 `a`
  - 合并目标在 `sessions` 里已不存在 → 不产生幽灵组、`notices` 里有一条 `merge-target-missing`
  - `query.text` 对 `signature`/`line` 做大小写不敏感子串匹配；`query.kinds: ['exit']` 只留 exit
  - `includeJobKilled: false` 时 `job-killed` 组不出现（默认 false）
  - `knownRevision === store.data.revision` → 返回同一形状但 `{ revision, unchanged: true, groups: [] }`，不重新分组
  - `updatePrefs({ ignore: [groupId] })` 后 `revision` +1、`ignored` 生效；`updatePrefs({ unignore: [groupId] })` 复原；`updatePrefs({ merge: [{ from, to }] })` 同 `tool+kind` 时生效、跨 `tool` 时抛错、`unmerge` 复原
  - `getLedger` 会触发一次 `checkStale`（用假 scanner 计数断言 ≤1 次），且 `getLedger` 本身不等待扫描完成
- [ ] 跑确认失败；实现；跑确认通过；`git commit`。

---

### Task 7: 插件入口、服务提供与 TYPERT 清单

**Files**
- Create: `lib/schemas.js`, `typert.js`；Modify: `index.js`, `package.json`（补 `./typert`、`./package.json`、`./locale/*.json` 导出）
- Test: `test/typert.test.js`, `test/entry.test.js`

**Interfaces**
- Consumes: `openLedger`、`createScanner`、`createService`、`normalizeConfig`、`resolveDshHome`。
- Produces: `ctx.provide('failureLedger', service)`；`TYPERT = { package: 'dsh-failure-ledger', face: 'host', schemas: [], invocations: [...], model }`，四个 `invocation`：`dsh-failure-ledger#failureLedger/{getLedger,getGroup,refresh,updatePrefs}`，`invocation: { kind: 'direct' }`，`service`/`namespace` 均为 `failureLedger`。

**Steps**
- [ ] 写 `test/typert.test.js`：断言 `TYPERT.package === 'dsh-failure-ledger'`、`face === 'host'`、`invocations.length === 4`、每个 `id` 以 `dsh-failure-ledger#failureLedger/` 开头、`result.mode === 'strict'`、`typeof result.create === 'function'`、`model.services[0].key === 'failureLedger'`、`model.events`/`model.objects` 是空数组。
- [ ] 实现 `lib/schemas.js`：用 zod 定义 `Failure`/`GroupRow`/`Occurrence`/`TOTALS`/`LEDGER_RESULT`/`GROUP_RESULT`/`PREFS` 七个 schema，导出 `schemaFor(name)`；`typert.js` 用 `strictCodec(name, schema) = { mode: 'strict', typeSymbol: 'dsh-failure-ledger#' + name, schema, create: () => schema }` 组装清单，`model` 里 `services[0]` 的 `members` 写 4 条 `{ kind: 'method', name, signature, summary }`（`signature` 形如 `getLedger(query: LedgerQuery | null, knownRevision: number | null): Promise<LedgerResult>`）。
- [ ] 跑 `node --test test/typert.test.js` 确认失败→实现→通过。
- [ ] 改 `index.js`：`apply` 里依次 `normalizeConfig` → `ledgerPath = config.ledgerPath ?? join(resolveDshHome(), 'storages', 'failure-ledger', 'ledger.json')` → `mkdirSync(dirname, { recursive: true })` → `openLedger` → 组装 `source`（`listSessions`/`stat`/`readSession`/`readTitle` 分别调 `ctx.sessionQuery.*`、`ctx.sessionPersistence.stat`）→ `createScanner` → `createService` → `ctx.provide('failureLedger', service)` → 若 `config.scanOnStartup` 起一个 `unref()` 的 5s 定时器调 `scanner.schedule()` → `ctx.effect(() => () => { /* abort + 最后一次 save */ })`。
- [ ] 写 `test/entry.test.js`：用假 ctx（`{ provide(), effect(), on(), get(), sessionQuery, sessionPersistence }`）跑 `apply`，断言 `provide` 被以 `'failureLedger'` 调用、返回值有四个方法、临时目录里生成了 `ledger.json`；`rawConfig` 非法时 `apply` reject。
- [ ] 跑 `npm test`；提交。重新 `install_bundle` 并在 Web 里确认插件加载无报错（此时还没 UI）。

---

### Task 8: 客户端 bundle 管线与空页面（侧栏 + 面板）

**Files**
- Create: `scripts/build-client.js`, `src/client/01-core.js`, `src/client/02-page.js`, `src/client/03-apply.js`, `lib/client.js`（构建产物）, `locale/zh.json`, `locale/en.json`；Modify: `package.json`（`exports['./client']`、`dsh.client.platform = 'web'`）
- Test: `test/client-bundle.test.js`

**Interfaces**
- Consumes: 无（本任务不发 RPC）。
- Produces: `lib/client.js`（单文件，`window.__ModuleLoader__.load({ id: 'dsh-failure-ledger', factory })`）、`apply`/`inject` 导出、面板 id `failure-ledger`。

**Steps**
- [ ] 写 `scripts/build-client.js`：按 `01-core.js`、`02-page.js`、`03-apply.js` 顺序读文本，拼成 `window.__ModuleLoader__.load({ id: 'dsh-failure-ledger', factory: (require) => { ...前三个文件的内容...; exports.apply = apply; exports.inject = inject; return module.exports } })` 写入 `lib/client.js`；每段文件内部只声明 `const/function`，不写 `export`。
- [ ] 写 `test/client-bundle.test.js`：跑构建脚本后断言产物能通过 `node --check`（`spawnSync(process.execPath, ['--check', out])`）、首行含 `__ModuleLoader__.load`、含 `id: 'dsh-failure-ledger'`、含 `exports.apply`。
- [ ] `src/client/01-core.js` 写：`const PANEL_ID = 'failure-ledger'`、`const NS = 'dsh-failure-ledger'`、`function codecOf(parse) { return { parse } }`、`function strictCodec(name, schema) { return { mode: 'strict', typeSymbol: 'dsh-failure-ledger#' + name, schema, create: () => schema } }`、`function rpcParam(name, type, schema, optional = false) { return { name, wire: name, source: 'json', codec: strictCodec(type, schema), ...(optional ? { acceptsUndefined: true } : {}) } }`，以及 `formatCount`/`formatRelativeTime`/`kindLabel` 三个纯函数。本任务的纯函数不单独测试，Task 9 通过构建产物里的实际调用来验证。
- [ ] `src/client/03-apply.js` 写 `inject = ['slots', 'layout', 'remote']`；`apply(ctx)`：注入 CSS（按内容比对写入 `data-plugin-css="dsh-failure-ledger/client.css"` 的 `<style>`）、`ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 50, label: () => t('panel'), locale: NS }, PanelIcon))`、`ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => ({ t }) }, Page))`。
- [ ] `02-page.js` 写最小页面：标题 + 一行「尚未扫描」占位；`PanelIcon` 用 `({ size }) => React.createElement('svg', ...)` 内联一个 16×16 的三角警示 SVG，**不依赖** `@deepseek-ai/dsh-client-ui-primitives` 里存在哪个图标名。
- [ ] 写 `locale/zh.json` 与 `locale/en.json`，键至少含 `panel`、`empty`、`title`、`refresh`、`scanning`、`filters.*`、`kinds.*`（七个 kind 的显示名）、`actions.*`、`notices.*`。
- [ ] `node scripts/build-client.js && node --test test/client-bundle.test.js` 通过；提交；重新 `install_bundle`，刷新 Web，确认侧栏出现条目、点击进入空页面、无控制台报错。

---

### Task 9: 客户端数据通路与分组列表

**Files**
- Modify: `src/client/01-core.js`（`CONTRIBUTION`、`mountRemote`、`useLedger`）、`src/client/02-page.js`（totals、筛选、分组表、提示条）、`locale/*.json`
- Test: `test/client-contribution.test.js`

**Interfaces**
- Consumes: Task 7 的 TYPERT 契约（`getLedger(query, knownRevision)` 返回 `LedgerResult`）。
- Produces: `CONTRIBUTION.descriptors` 四个方法（`getLedger` 2 参、`getGroup` 2 参、`refresh` 1 参、`updatePrefs` 1 参），每个 `result` 都是 `strictCodec`；`ctx.get('remote.failureLedger')`。

**Steps**
- [ ] 写 `test/client-contribution.test.js`：解析构建后的 `lib/client.js` 文本，断言四个 `method: '...'` 存在、`getLedger` 的 `parameters` 有两个（`query`、`knownRevision`）、每个参数带 `acceptsUndefined: true`（因为都允许 undefined）、`refresh` 有 1 个参数 `full`、`updatePrefs` 有 1 个参数 `patch`。
- [ ] `01-core.js` 加 `CONTRIBUTION`（`package: 'dsh-failure-ledger'`）、`async function mountRemote(ctx)`（`remote.$mount` + `ctx.effect` 释放）、`useLedger([], { intervalMs: 5000 })` 钩子（`useEffect` + `useState`，`knownRevision` 短路）。
- [ ] `02-page.js` 实现：顶部 totals（失败数/组数/会话数/扫描错误数/未知结果数/最后扫描时间）、筛选栏（工具输入、kind 多选、文本、时间范围、`includeJobKilled`、`hideIgnored`）、分组表（计数、工具、kind、签名、最后出现、会话数）、`scanErrors` 提示条、`notices` 提示条、扫描进行中的进度条（`scanning.done/total`）。
- [ ] 构建 + 测试通过；提交；`install_bundle` 后刷新，确认真实数据出现在页面上，且**不产生任何模型请求**（观察会话列表没有新会话）。

---

### Task 10: 分组明细、静音、合并、手动刷新

**Files**
- Modify: `src/client/02-page.js`、`src/client/01-core.js`、`locale/*.json`
- Test: `test/prefs-contract.test.js`

**Interfaces**
- Consumes: `getGroup(groupId, limit)`、`updatePrefs(patch)`。
- Produces: `patch = { ignore?: string[], unignore?: string[], merge?: { from: string, to: string }[], unmerge?: string[], rulesVersion?: number }`。

**Steps**
- [ ] 写 `test/prefs-contract.test.js`：断言 `updatePrefs` 的 `patch` 参数在 `lib/client.js` 里被 `acceptsUndefined: false` 声明、`getGroup` 参数为 `groupId`+`limit`；并断言 `02-page.js` 里出现 `hideIgnored`、`includeJobKilled` 的默认值 `false`。
- [ ] `02-page.js`：点击分组 → 调 `getGroup` 取前 20 条出现记录（时间、会话标题、cwd、原始行），提供「复制 session id」按钮；行选择（checkbox）→「合并到…」下拉（只列同 `tool` 且同 `kind` 的组）→ `updatePrefs({ merge: [{ from, to }] })`；单组「静音」→ `updatePrefs({ ignore: [groupId] })`；顶部「重新扫描」→ `refresh(true)`。
- [ ] 手动验证：真实数据里制造一次失败（例如 `bash -c 'false'`），5–16 秒内出现在页面上；静音后消失；取消静音后回来；合并两组后计数相加。
- [ ] 提交。

---

### Task 11: 真实日志端到端对账、性能与收尾

**Files**
- Create: `test/e2e-live.test.js`（`FAILURE_LEDGER_E2E=1` 才跑）、`README.md`；Modify: 视对账结果修 `lib/signature.js` / `lib/detect.js`
- Test: `test/e2e-live.test.js`

**Interfaces**
- Consumes: 全部。
- Produces: 无（验证与文档）。

**Steps**
- [ ] 写 `test/e2e-live.test.js`：仅当环境变量 `FAILURE_LEDGER_E2E=1` 时执行；用真实 `~/.dsh/sessions` 跑完整 `run({ full: true })`，断言：扫描会话数 > 0、`groups.length > 0`、无 `scanError` 的会话占多数、耗时打印到控制台、台账文件 < 5MB。
- [ ] 跑 `FAILURE_LEDGER_E2E=1 node --test test/e2e-live.test.js`，把 `groups` 的 top 20 与 `/tmp/failprobe.mjs` 的输出对账；对不上的组逐个判明是检测规则缺口还是签名归一化缺口，补测试再改实现。
- [ ] 长尾修整：确认没有出现 `===`/`}`/`REMOTE` 这类碎组仍被当作主签名（如有，扩展 Task 2 的噪声行规则）。
- [ ] `README.md` 写：一句用途、`install_bundle` 安装步骤、配置项表、数据文件位置与删除方法、隐私说明（只读本地会话、绝不上传）。
- [ ] 全量 `npm test`；提交；`install_bundle` 最终验证：刷新页面、扫描、分组、静音、合并各走一遍并截图留档。

---

## 执行注意事项

- 每个任务开始前 `git status` 必须干净；任务内每完成一个可验证步骤就跑对应测试，不要攒到最后。
- 遇到需要改 spec 的发现（例如某个事件字段实际不存在），先改 spec 再改代码，别让文档和实现漂移。
- 客户端 JS 是拼接进 `factory` 的普通脚本：只能声明 `const`/`function`，不能写 `import`/`export`；新增文件要同步改 `scripts/build-client.js` 的列表。
- 每次改客户端都要重新 `node scripts/build-client.js` 并刷新页面；宿主改动需要重启 DSH 或重装 bundle。
- 若 `install_bundle` 因 profile 校验失败，先看 profile 的 `cordis.yml` 与 `package.json` 是否被正确写入，不要手改 profile 文件。
- `install_bundle` 的 `target` 传包目录绝对路径；若该版本工具只接受 npm spec，再用 `npm link`/`link:` 落到 profile，并在计划外记一条偏差说明。
