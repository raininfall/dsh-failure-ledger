# 会话失败台账（dsh-failure-ledger）设计稿

日期：2026-11-21（v2，已过 builder review）　状态：待用户批准
作者：lead（与用户共同澄清）

## 1. 意图与为什么

用户要一个 DSH 插件：把 session log 里**工具调用、脚本调用失败**的信息收上来，按**确定性规则**分组，用来看"到底什么在反复坏"。明确不要 AI：不生成报告、不做模型总结、不做语义聚类。产物就是一份可浏览的分组清单。

"废除报告"经澄清 = **不生成报告**。本设计不含任何 AI 摘要、markdown 导出、定时报告任务。

为什么现在做：本机 `~/.dsh/sessions` 已有 1663 个会话、206MB 日志。抽查最近 30 个会话：1093 次 `tool/result`、731 次 `job/settled`（其中 25 次后台作业以非零退出或被杀结束）。失败信息都写在日志里，只是没有地方能跨会话看"哪一类失败在重复"。

## 2. 目标 / 非目标 / 反目标

**目标**
- 跨会话收集失败事件，每条可回溯到 `sessionId + seq`。
- 按 `工具 + 失败类别 + 归一化错误行` 确定性分组，同一数据任何时候结果一致。
- 首次全量扫描后增量更新；扫描期间页面可用并显示进度。
- 按时间/工具/类别/关键字过滤；组可展开到每次发生，并能跳到所属会话。
- 人工**合并组**、**静音组**（用户操作，非 AI），偏好持久化。

**非目标**
- 不做 AI 归类、不做根因分析、不生成报告文档。
- 不做日志编辑、不重跑失败命令、不写任何会话事件。

**反目标**（做了就算失败）
- 首开数分钟无反馈。
- 分组随扫描顺序漂移。
- 向 Chat / Agent 注入任何内容，改变模型可见上下文。

## 3. 约束（已核实）

- 宿主：DSH Web profile（`~/.dsh/profiles/web`，`release/dsh-v0.2.2-rc.5`）。
- 会话日志是唯一事实来源，插件只读。
- `tool/result` 仅当 `message.isError === true` 才有 `error {name, code, reason}`。
- bash 不把非零退出置为 `isError`；标记写在结果正文（`packages/shell/tool-bash/src/render.ts:23-70`）：`[stderr]` 段、`[exit code: N]`、`[killed by signal: X]`、`[timed out after Nms]`、`[stopped: ...]`。
- 后台脚本走 `job/settled`（`{ jobId, owner, kind, label, startedAt, toolCall?, finishedAt, status, cause, producerReported, detail? }`）。**关键事实**：命令以非零退出结束时 `status` 仍是 `completed`，退出码写在 `detail`（实测 30 个会话里 727 次 `completed|bash`，其中 22 次 `exit code: 1`、2 次 `exit code: 127`、1 次 `exit code: 28`）；被杀才是 `status: killed` + `detail: "signal: SIGTERM; <reason>"`。
- 本机无 `zstd` CLI；插件不自己解 `.jsonl.zstd`，一律走宿主服务。
- Web profile 的 `session-query-sqlite` 是 `openAt: never`（`packages/bundle/base/cordis.patch.yml:157`）：全文搜索不可用，精确读取/过滤/谱系可用 —— 够用。
- 安装：workspace 写 bundle，`plugin_manager install_bundle` 装进 profile。`./typert` 导出会被 `dsh-typert-loader`（`packages/bundle/base/cordis.patch.yml:49`）自动注册到 Host 侧。
- **第三方包的 Client 侧不走生成管线**：`dsh-cost-meter` 的做法是 Host 手写 `./typert` 清单 + Client 手写 descriptors 后 `ctx.remote.$mount(CONTRIBUTION)`（`src/client/03-settings-panels-main.js:1836-1841`、descriptors 在 `src/client/02-validators-helpers-sidebar.js:580+`）。本插件照抄这条已验证路径。

## 4. 方案（已选 B）

| 方案 | 呈现 | 扫描范围 | 首次耗时 | 代价 |
|---|---|---|---|---|
| A 会话内轻量 | 会话右栏 Tab | 仅当前会话 | < 0.2 s | 看不到跨会话复发 |
| **B 全局失败台账（用户选它）** | 侧栏「失败台账」+ 主面板 keyed 页 | 全部历史会话，增量索引 | 首次 20–60 s，之后秒开 | 需维护索引与增量记账 |
| C 只做工具 | Agent 工具，无 UI | 按需 | — | 要模型去调，与"不要报告"的初衷相悖 |

## 5. 失败判定

| 来源 | 判定 | `kind` | 签名取自 |
|---|---|---|---|
| `tool/result` | `message.isError === true` | `error`（附 `errorCode`/`errorName`） | `error.reason` → `error.name` → 正文错误行 |
| `tool/result` | 正文 `[exit code: N]` 且 N ≠ 0 | `exit`（附 `exitCode`） | 正文错误行 |
| `tool/result` | 正文 `[killed by signal: X]` | `signal`（附 `signal`） | 标记行 + 错误行 |
| `tool/result` | 正文 `[timed out after Nms]` | `timeout`（附 `timeoutMs`） | 标记行 + 错误行 |
| `job/settled` | `status === 'failed'`，或 `detail` 精确匹配 `/^exit code: (\d+)$/` 且 ≠ 0 | `job-failed`（附 `exitCode`） | `detail` + 该作业最近一次输出行 |
| `job/settled` | `status === 'killed'` | `job-killed`（附 `signal` 与 `reason`） | `detail` 的 `signal: X; <reason>` 段 |
| `tool/ptc-dispatch` | `isError === true`（PTC 模式的子工具调用） | `ptc-error` | `error.reason` → `content` 错误行；工具名取事件的 `name` |

说明：
- `job/settled` 的 `detail` 用严格正则解析，不猜自由文本；解析不出且 `status` 正常就按成功处理（计入 `unknownOutcome` 计数供观察，不单独成组）。
- 工具名：`tool/result` 用同会话 `tool/call` 映射 `toolCallId`；`job/settled` 用 `toolCall.callId`（实测 30 个会话里 731 次全部有 `toolCall`），缺失时用 `job`。
- PTC 事件目前在本 profile 的 30 个采样会话里出现 0 次（当前走原生工具循环），检测器照常实现，属于低成本保险；`Config.includePtcDispatch` 默认 true。

## 6. 分组算法（确定性核心）

**签名抽取**（纯字符串规则）：

1. 取候选文本：有 `[stderr]` 段就用该段，否则用正文。
2. 删掉命令回显行（`[rtk] ran: ...`）与标记行本身（`[exit code: N]`、`[killed by signal: ...]`、`[timed out ...]`、`[stopped: ...]`、`[stderr]` 标题行）。
3. 选错误行，两级排序：
   a. **判词行**：形如 `<Xxx>Error: ...`、`<Xxx>Exception: ...`、`bash: ...`、`fatal: ...`、`FAIL...`、`panic: ...` 的行；
   b. **关键词行**：命中 `\b(error|exception|failed|failure|denied|refused|not found|no such|cannot|could not|invalid|unable|missing)\b` 的行（用词边界，避免 `isError` 这类标识符误命中）。
   先在 `[stderr]` 段内按 a→b 各取第一条，再在全文按 a→b 各取第一条；都没有才退到 c/d。
   c. 否则 `[stderr]` 段的第一条非空行；
   d. 否则正文最后一条非空行。
   *为什么 a 优先于 b*：实测有一条把测试源码回显行（含 `error record` 字样）当成签名，而真正的判词是后面的 `AssertionError: ...`。
   *为什么 b 优先于 c*：实测 30 会话里出现 `signature` 为 `===`、`}`、`REMOTE` 这类碎组，正是"取末行"造成的；stderr 首行更接近真正的失败原因。

**后台作业的签名**：`job/settled` 不带 stderr 文本，`detail` 往往只有 `exit code: N` 或 `signal: X; 原因`。因此：
- `detail` 带 `; ` 原因时用原因串做签名（如 `signal: SIGTERM; Broad grep too slow` → `Broad grep too slow`）；
- 否则用作业的 `label`（命令摘要）做签名，让不同脚本的失败不挤进同一个 `exit code: <n>` 组；
- `label` 与 `detail` 都为空才退回 `kind` 兜底。
4. 归一化：去 ANSI；Unix 绝对路径与 Windows 盘符路径 → `<path>`；UUID/≥8 位 hex → `<id>`；`行:列` 与裸露数字 → `<n>`；折叠空白；截断 160 字符。
5. 签名空则用 `kind` 兜底；同时保存未归一化的 `line`（≤400 字符）供人工判断。

**分组键**：`groupId = sha1(tool + '\u0000' + kind + '\u0000' + signature)` 前 16 位十六进制。
同 `tool + kind` 下不同 `signature` 是不同组（"变体"），不做模糊合并。

**为什么不用模糊聚类**：要求可复现、可解释、可人工纠正。规则组 + 人工合并/静音已覆盖需求，永不漂移。

**人工操作**（存偏好，查询时套用）：
- 静音：`prefs.ignored: GroupRef[]`。
- 合并：`prefs.merge: Record<fromGroupId, toGroupId>`，扁平表、只允许同 `tool + kind`、禁止链式与环（写入时扁平化，读取时单跳解析）。合并后计数相加、次数按成员累加，展开时按成员分组展示。支持取消合并（删除该条映射）。

**规则版本**：`RULES_VERSION` 常量随签名规则变更递增，写进索引。查询时 `groupId` **由存储的 `tool/kind/signature` 现算**，因此规则升级后可重新派生；`prefs` 里同时存 `GroupRef = {groupId, tool, kind, signature}`，规则变更导致对不上时在设置区显示"N 条静音/合并规则已失效"并提供清除，而不是静默丢弃。

## 7. 数据模型

单文件 JSON：`$DSH_HOME/storages/failure-ledger/ledger.json`（与 `$DSH_HOME/storages/cost-meter/ledger.json` 同级习惯）。原子写：写 `ledger.json.tmp` 后 `rename`。

索引只保留仍然存在的会话：每次扫描把 `sessions` 里不在 `listSessions` 结果中的条目删掉（日志已删则条目没有依据）；`retentionDays` 只裁剪失败记录本身。

```jsonc
{
  "schemaVersion": 1,          // 数据结构版本，固定
  "revision": 42,              // 每次落盘/偏好变更 +1；Client 用它判断新旧
  "rulesVersion": 1,           // 签名规则版本
  "updatedAt": 1763700000000,
  "prefs": { "ignored": [], "merge": {} },
  "sessions": {
    "<sessionId>": {
      "fingerprint": { "eventCount": 1234, "sizeBytes": 45678 },
      "scannedAt": 1763700000000,
      "cwd": "/Users/rain/lab/deepseek-harness",
      "title": "…",
      "origin": "subagent?",       // 仅记录，不参与筛选默认值
      "inheritedEventCount": 120,  // 被跳过的 fork 继承前缀长度
      "scanError": { "code": "SESSION_QUERY_CORRUPT_SESSION", "message": "…" },
      "failures": [
        { "at": 1763700000000, "turn": 3, "step": 5, "seq": 1234,
          "tool": "bash", "kind": "exit", "exitCode": 1,
          "signature": "Error: BLOCKED by CC Safety Net",
          "line": "Error: BLOCKED by CC Safety Net",
          "callId": "call_…" }
      ]
    }
  }
}
```

- 内嵌 per session，便于增量替换与按会话清理；估算本机全量几千条记录、几 MB JSON，所以**不引入 SQLite**。
- `prefs` 不含 `retentionDays`（见 §11，配置项唯一权威）。

## 8. 索引与增量

**枚举**：`ctx.sessionQuery.listSessions()` → `SessionRecord[]`（`header.id/createdAt/cwd/parentSession/origin/isSeeded`，newest first）。

**保留窗口**：只索引 `failures[].at >= now - retentionDays` 的失败记录（按**失败发生时间**，不按会话创建时间）；整个会话没有窗口内失败时只保留 `fingerprint`。

**继承前缀**：`readSession` 返回的快照含 fork 继承的事件前缀（`inheritedEventCount`）。只折叠**自有事件**（`seq >= inheritedEventCount`），否则每个 fork/子会话都会把父会话的失败再数一遍，且会绕过保留窗口。跳过的条数记在 `inheritedEventCount`。

**脏检测**：用 `fingerprint = { eventCount, sizeBytes }`（来自 `ctx.sessionPersistence.stat(id)`）比对；同一进程内再叠加 `revision` 作为补充。理由：persistence 的 `revision` 文档只保证"同一服务实例内可比"，不能跨重启持久化比较（见风险 §14）。若 `eventCount/sizeBytes` 在实现侧不可得或不稳定，退化方案是每次启动做一次全量重读——落地前先验证 `stat()` 的实际返回字段。

**读取**：只读脏会话，`ctx.sessionQuery.readSession(id)`；单遍折叠出 `callId → 工具名` 与失败记录。读失败（`SESSION_QUERY_CORRUPT_SESSION` / `SESSION_QUERY_PERSISTENCE_FAILED`）写进该会话的 `scanError` 并继续，绝不中断整轮扫描。

**并发与落盘**：并发 4（`Config.scanConcurrency`），每 50 个会话或每 2 秒落盘一次并 `revision++`。

**触发**：页面首开 `refresh()`；`Config.scanOnStartup` 时插件启用后延迟 5 秒增量一轮；宿主 `turn/end` 把该会话标脏排队重扫（≤3 秒反映当前会话）。

**进度**：扫描中 `getLedger` 返回 `scanning: { done, total }`；查询不阻塞，先返回已有结果。

## 9. 宿主接口

Host 侧 Cordis 服务 `ctx.failureLedger`，Remote namespace `failureLedger`；Host 手写 `./typert` 清单（结构照 `~/lab/dsh-cost-meter/lib/typert.host.js` 的 `TYPERT` + `strictCodec`），Client 手写对应 descriptors 并 `ctx.remote.$mount(CONTRIBUTION)`。

| 方法 | 参数 | 返回 |
|---|---|---|
| `getLedger` | `{ query?, knownRevision? }` | `{ revision, scanning, totals, groups }`；`knownRevision` 命中则 `{ unchanged: true }` |
| `getGroup` | `{ groupId, limit }` | `{ group, occurrences }` |
| `refresh` | `{ full?: boolean }` | `{ started }` |
| `updatePrefs` | `{ patch: { ignored?, merge? } }` | 新 `prefs`（同时 `revision++`） |

`query`：`{ from, to, tool, kinds, sessionId, cwd, text, includeKilled, sort, limit }`；`text` 对 `signature + line` 做不区分大小写子串匹配。
`totals`：`{ failures, groups, sessions, scanErrors, unknownOutcome, lastScanAt }`。

## 10. 客户端页面

- 侧栏条目：`sidebar.panellist` 注册 `{ id: 'failure-ledger', label: () => t('panel'), locale }` + 原创 SVG 图标（跟随主题令牌）。
- 页面：`main` keyed 注册 `{ key: 'failure-ledger' }`，点侧栏条目 `ctx.layout.selectPanel('failure-ledger')`。写法参考 `packages/client/ui-plugin-manager/src/client/index.ts:167`（侧栏）与 `:181`（main）。
- 布局（单列，全部用 `--dsw-alias-*` 令牌与宿主字号/间距，参考插件管理页的列表风格）：
  1. 顶部过滤条：时间范围（今天/7 天/30 天/全部）、工具下拉、类别下拉、"含被取消的后台作业"开关、关键字输入、刷新按钮、隐藏静音组开关。
  2. 扫描进度条（仅扫描中）；`totals.scanErrors > 0` 时显示一条提示带"N 个会话读取失败，台账可能不完整"。
  3. 分组列表行 = 工具徽标 + kind 徽标 + 签名单行 + 次数 + 最近时间；单击展开最近 20 条 occurrence（时间、会话标题、原始 `line`、「打开会话」）。
  4. 多选模式 → 「合并到…」选择目标组，只列出同工具同类别的组；已合并组显示「取消合并」。每行的「静音」把组写入 `prefs.ignored`，顶部开关可切回查看。
  5. 空态：索引为空时给「开始首次扫描」按钮；扫描完无结果时显示当前范围没有失败。
- 自动刷新：页面可见时每 5 秒带 `knownRevision` 调 `getLedger`，未变则不动；页面不可见不轮询。
- 文案走 Client locale（zh/en 两套字典）。

## 11. 配置（`cordis.patch.yml`）

| 字段 | 默认 | 含义 |
|---|---|---|
| `retentionDays` | `90` | 只索引该天数内的失败（0 = 全部）；**配置项是唯一权威**，不进 prefs |
| `scanOnStartup` | `true` | 启用后延迟扫描一次 |
| `scanConcurrency` | `4` | 只读会话日志的并发数 |
| `includeSubagents` | `true` | 是否收录 `origin === 'subagent'` 的会话 |
| `includePtcDispatch` | `true` | 是否把 `tool/ptc-dispatch` 的 `isError` 算作失败 |
| `ignorePatterns` | `[]` | 命中即丢弃的正则（作用于 `signature`），压噪音的后门 |

## 12. 性能与验证目标

- 首开：索引为空时 ≤3 秒返回首页（后台继续扫）；全量 ≤90 秒（本机 206MB / 1663 会话实测后再收紧）。
- 复看：`getLedger` ≤150 ms。
- 增量：`turn/end` 后 ≤3 秒新失败可见。

## 13. 测试计划

1. **签名抽取单测**（fixture 来自真实日志）：CC Safety Net 拦截、`zstdcat: command not found`、TS 语法错误、git 冲突、`[rtk] ran:` 回显、只有 `===`/`}` 的输出、超时、被杀、后台作业 `detail: "exit code: 1"`。
2. **分组稳定性**：同批事件折叠两次、顺序打乱，groupId 与计数一致。
3. **继承前缀**：fork 会话不重复计数父会话失败；保留窗口按失败时间生效。
4. **增量正确性**：fingerprint 变化才重读；会话删除清理记录；读失败记 `scanError` 且不中断。
5. **偏好语义**：静音/合并在查询层生效、可逆、禁止跨 tool+kind 合并。
6. **端到端**：对真实 `$DSH_HOME/sessions` 跑一次，与探针脚本 `/tmp/failprobe.mjs` 的口径核对（差异要能解释，例如它不数 `detail` 退出码）。
7. **UI 验证**：装进 web profile 后真实页面点一遍（过滤、展开、合并、静音、打开会话），确认无空白与控制台错误。

## 14. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 首扫慢 | 首开体验差 | 后台扫描 + 进度 + 先返回已有；保留 90 天 |
| `stat()` 指纹字段不稳定 | 增量失效或漏更新 | 落地前先验证字段；退化到启动全量重读 |
| 签名规则分不准 | 碎组/错并 | 保留 `line`；人工合并/静音；规则版本 + 单测迭代 |
| 「打开会话」对跨 workspace/子会话可能不通 | 跳转失效 | 先验证 `ctx.uiWorkspace.openSession` 行为，不支持时退化为复制 session id |
| 手写 typert 清单与宿主版本耦合 | 升级后 RPC 失效 | `dsh.compatibility` 限区间；RPC 失败时页面显示明确错误 |
| 会话日志格式升级 | 读取失败 | 只走 `ctx.sessionQuery` 抽象 |

## 15. 我替你做的决定（可推翻）

1. 代码独立成包 `~/lab/dsh-failure-ledger`，`plugin_manager install_bundle` 装进 web profile，不进 `deepseek-harness` 仓库。
2. 存储用单 JSON 文件，不上 SQLite。
3. Host↔Client 走 hand-written typert Remote + Client 手写 descriptors，照 cost-meter 已验证路径。
4. 客户端用 esbuild 打包 JSX；Host 侧直接写 ESM JS，不引入 TypeScript 工程。
5. 默认收录全部失败（含 `grep` 无匹配这类良性退出），用一键静音压噪音而不是内置白名单。
6. `job-killed` 收录但默认在页面过滤掉（开关可开），因为人工取消的后台作业不算故障。
7. 保留 90 天，按失败时间计算。
8. 合并只允许同工具同类别、扁平单跳；支持取消合并。
9. 规则升级不迁移 `prefs`，而是显示"规则已失效"让用户处理。

## 16. 留给实现者的自由

- 页面视觉细节（行高、徽标、空态）按宿主列表页风格定。
- 错误行锚点词表的细节打磨（以单测为准）。
- 默认排序（次数或最近时间）与分页粒度。
- 是否把"变体"做成组内二级展开。
- `job` 失败签名里如何带上最近一次输出行（需要时读父调用的 `tool/result`）。
