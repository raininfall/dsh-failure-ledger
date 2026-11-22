# Failure Ledger Query Interfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three query capabilities to `dsh-failure-ledger` — the log around one failure, per-group baseline ignores, and fuller occurrence details — and wire the first two into the panel.

**Architecture:** `getFailureContext` reads one session through the existing `sessionQuery` source and normalizes the events of the failing turn in a new `lib/context.js`; baseline ignores filter occurrences during the existing read path in `lib/service.js`; `getGroup` widens its projection. The panel gets two small actions and one context viewer; the client bundle is rebuilt from `src/client/`.

**Tech Stack:** Node >= 24.9, ESM, zod (already a dependency), `node --test`, hand-written `React.createElement` client bundle built by `scripts/build-client.js`.

**Spec:** `/Users/rain/lab/dsh-failure-ledger/docs/superpowers/specs/2026-11-22-query-interfaces-design.md`

## Global Constraints

- No new runtime dependencies; ESM everywhere.
- Every host method must be registered in all four wire places: `lib/schemas.js` `SCHEMAS`, `typert.js` `TYPERT.invocations` and `TYPERT.model.services[0].members`, `src/client/01-core.js` `CONTRIBUTION` and `SERVICE_METHODS`, with identical method names.
- `SCHEMA_VERSION` stays `1`; old ledger files must load after `completeLedger` fills `prefs.since`.
- After any `src/client/*.js` or `locale/*.json` change run `node scripts/build-client.js` and commit `lib/client.js`.
- Tests use `node --test`; commit only files this plan touches.
- Do not dispatch code-review subagents (owner rule, 2026-11-20): the owner reviews the diff.

## Review Focus

- A ledger failure whose session was deleted or rotated away: `getFailureContext` must answer `found: false`, never throw.
- A failure in the first turn, with no `turn/start` before it: context starts at the first event.
- `maxChars` smaller than the single failure entry: keep the entry, report `truncated: true` and `dropped: 0`.
- Baseline set on a group that is merged into another: the cutoff follows the merge target, and `unsince` restores counts with no negatives.
- `getLedger` polled with a matching `knownRevision`: totals are still computed post-baseline and never resurrect pre-baseline counts.

---

### Task 1: Read the log around one failure

**Files:**
- Create: `lib/context.js`
- Modify: `lib/config.js` (defaults at 7-24, limits at 26-30), `lib/schemas.js` (after `ledgerQuery`, SCHEMAS map at 135-152), `lib/service.js` (imports at 1-2, `createService` at 224, return at 368), `typert.js` (58-99), `index.js` (113-114)
- Test: `test/context.test.js` (create), `test/wire-roundtrip.test.js`, `test/typert.test.js`, `test/config.test.js`

**Interfaces:**
- Consumes: `flattenContent(content)` from `lib/detect.js`; `readSession(sessionId)` returning `{ session, inheritedEventCount, events }`.
- Produces: `contextAround(events, seq, failure)` → `{ found, turn, entries }`; `trimEntries(entries, maxChars)` → `{ entries, chars, dropped, truncated }`; service method `getFailureContext(input)` → `FailureContext`.

- [ ] **Step 1: Write the failing tests**

`test/context.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import { contextAround, trimEntries } from '../lib/context.js'
import { createService } from '../lib/service.js'
import { normalizeConfig } from '../lib/config.js'

const NOW = 1_760_000_000_000
const event = (seq, type, data) => ({ seq, time: NOW + seq, type, data })
const text = (body) => [{ type: 'text', text: body }]

const EVENTS = [
  event(0, 'turn/start', { turn: 1 }),
  event(1, 'user/message', { id: 'u1', content: text('fix the build'), source: 'user' }),
  event(2, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"command":"npm test"}' }),
  event(3, 'tool/result', { turn: 1, step: 1, message: { toolCallId: 'c1', isError: true, content: text('Error: boom') } }),
  event(4, 'turn/start', { turn: 2 }),
  event(5, 'tool/call', { turn: 2, step: 1, callId: 'c2', name: 'bash', arguments: '{"command":"npm run build"}' }),
  event(6, 'tool/result', { turn: 2, step: 1, message: { toolCallId: 'c2', isError: false, content: text('built') } }),
  event(7, 'tool/result', { turn: 2, step: 2, message: { toolCallId: 'c2', isError: true, content: text('Error: build failed') } }),
]

const FAILURE = { line: 'Error: build failed', tool: 'bash', kind: 'error', signature: 'build failed' }

test('context starts at the turn holding the failure and keeps arguments verbatim', () => {
  const around = contextAround(EVENTS, 7, FAILURE)
  assert.equal(around.found, true)
  assert.equal(around.turn, 2)
  assert.deepEqual(around.entries.map((entry) => entry.kind), ['turn', 'tool', 'result', 'result', 'failure'])
  assert.equal(around.entries[0].text, 'turn 2')
  assert.equal(around.entries[1].text, '{"command":"npm run build"}')
  assert.equal(around.entries[2].name, 'bash')
  assert.equal(around.entries[3].isError, true)
  assert.equal(around.entries[4].text, 'Error: build failed')
})

test('an unknown sequence reports not found', () => {
  assert.deepEqual(contextAround(EVENTS, 99, FAILURE), { found: false, turn: 0, entries: [] })
})

test('a failure without any turn start still yields its events', () => {
  const around = contextAround([EVENTS[2], EVENTS[3]], 3, FAILURE)
  assert.equal(around.found, true)
  assert.deepEqual(around.entries.map((entry) => entry.kind), ['tool', 'result', 'failure'])
})

test('trimming drops the oldest entries and keeps the failure', () => {
  const entries = [
    { kind: 'tool', text: 'x'.repeat(40) },
    { kind: 'result', text: 'y'.repeat(40) },
    { kind: 'failure', text: 'boom' },
  ]
  const trimmed = trimEntries(entries, 60)
  assert.equal(trimmed.dropped, 1)
  assert.equal(trimmed.truncated, true)
  assert.deepEqual(trimmed.entries.map((entry) => entry.kind), ['result', 'failure'])
  assert.equal(trimmed.chars, 44)
})

test('a failure larger than the budget is kept and still marked truncated', () => {
  const trimmed = trimEntries([{ kind: 'failure', text: 'z'.repeat(50) }], 10)
  assert.equal(trimmed.entries.length, 1)
  assert.equal(trimmed.dropped, 0)
  assert.equal(trimmed.truncated, true)
  assert.equal(trimmed.chars, 50)
})

test('the service reads the session and reports the stored failure', async () => {
  const store = {
    data: {
      revision: 1,
      prefs: { ignored: [], merge: {}, since: {} },
      sessions: { s1: { title: 'demo', cwd: '/w', failures: [{ ...FAILURE, at: NOW, turn: 2, step: 2, seq: 7 }] } },
    },
    touch() {},
    isDirty() { return false },
    async save() {},
  }
  const service = createService({
    store,
    scanner: { async checkStale() { return false } },
    config: normalizeConfig({ contextMaxChars: 1000 }),
    readSession: async () => ({ session: { id: 's1', title: 'demo' }, inheritedEventCount: 0, events: EVENTS }),
  })
  const context = await service.getFailureContext({ sessionId: 's1', seq: 7 })
  assert.equal(context.found, true)
  assert.equal(context.sessionTitle, 'demo')
  assert.equal(context.tool, 'bash')
  assert.equal(context.chars > 0, true)
  assert.equal(context.truncated, false)
  assert.equal(context.entries.at(-1).kind, 'failure')
  assert.equal((await service.getFailureContext({ sessionId: 's1', seq: 99 })).found, false)
  await assert.rejects(() => service.getFailureContext({ seq: 7 }), /session id/)
})

test('a session that was rotated away reports not found instead of failing', async () => {
  const store = {
    data: { revision: 1, prefs: { ignored: [], merge: {}, since: {} }, sessions: {} },
    touch() {},
    isDirty() { return false },
    async save() {},
  }
  const service = createService({
    store,
    scanner: { async checkStale() { return false } },
    config: normalizeConfig({}),
    readSession: async () => { throw new Error('session missing') },
  })
  const context = await service.getFailureContext({ sessionId: 'gone', seq: 3 })
  assert.equal(context.found, false)
  assert.deepEqual(context.entries, [])
})
```

`test/config.test.js` additions:

```js
test('contextMaxChars is validated from cordis.yml', () => {
  assert.equal(normalizeConfig({}).contextMaxChars, 20000)
  assert.equal(normalizeConfig({ contextMaxChars: 5000 }).contextMaxChars, 5000)
  assert.throws(() => normalizeConfig({ contextMaxChars: 10 }), /contextMaxChars/)
  assert.throws(() => normalizeConfig({ contextMaxChars: 1.5 }), /contextMaxChars/)
})
```

`test/wire-roundtrip.test.js` addition:

```js
test('ContextQuery and FailureContext validate over the wire', () => {
  const query = schemaFor('ContextQuery').create()
  assert.doesNotThrow(() => query.parse({ sessionId: 's1', seq: 3 }))
  assert.doesNotThrow(() => query.parse({ sessionId: 's1', seq: 3, maxChars: 500 }))
  assert.throws(() => query.parse({ seq: 3 }))
  const context = schemaFor('FailureContext').create()
  assert.doesNotThrow(() => context.parse({
    found: true, sessionId: 's1', seq: 3, entries: [{ kind: 'tool', text: 'x' }], chars: 1, truncated: false, dropped: 0,
  }))
})
```

`test/typert.test.js`: change `four invocations` to `five invocations`, length 4→5, the sorted method list to `['getFailureContext', 'getGroup', 'getLedger', 'refresh', 'updatePrefs']`, `members.length` 4→5, and add:

```js
const context = TYPERT.invocations.find((invocation) => invocation.method === 'getFailureContext')
assert.deepEqual(context.parameters.map((parameter) => parameter.name), ['input'])
assert.equal(context.parameters[0].acceptsUndefined, undefined)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/context.test.js test/config.test.js test/wire-roundtrip.test.js test/typert.test.js`
Expected: FAIL — `Cannot find module '../lib/context.js'`, `contextMaxChars` undefined, unknown schema.

- [ ] **Step 3: Implement `lib/context.js`**

Signatures:

```js
export function contextAround(events, seq, failure)
export function trimEntries(entries, maxChars)
```

`contextAround` finds `events[index].seq === seq` (else `{ found: false, turn: 0, entries: [] }`), walks back to the nearest `turn/start` as `start` (0 when none), collects `tool/call` names by `callId` from events before `start`, then maps `start..index` into entries:

| event type | entry |
|---|---|
| `turn/start` | `{ kind: 'turn', text: 'turn ' + (data.turn ?? 0) }` |
| `user/message` | `{ kind: 'user', text: flattenContent(data.content) }` |
| `assistant/message` | `{ kind: 'assistant', text: flattenContent(data.message.content) }` |
| `tool/call` | `{ kind: 'tool', name: data.name, callId: data.callId, text: data.arguments ?? '' }` |
| `tool/result` with object `message` | `{ kind: 'result', name: callNames.get(message.toolCallId) ?? '?', callId, isError: message.isError === true, text: flattenContent(message.content) }` |
| `job/settled` | `{ kind: 'job', text: data.detail ?? data.label ?? data.status ?? '' }` |
| `tool/ptc-dispatch` | `{ kind: 'ptc', name: data.name, isError: data.isError === true, text: flattenContent(data.content) }` |
| anything else | skip |

Then append `{ kind: 'failure', text: failure.line, name: failure.tool }` when `failure` is given, and return `{ found: true, turn, entries }` with `turn` from `events[index].data?.turn ?? events[start].data?.turn ?? 0`.

`trimEntries` sums `entry.text.length` into `chars`, drops from the front while `chars > maxChars && kept.length > 1`, and returns `{ entries: kept, chars, dropped, truncated: dropped > 0 || chars > maxChars }`.

- [ ] **Step 4: Implement the service method**

In `lib/config.js` add `contextMaxChars: 20000` to `CONFIG_DEFAULTS` with a one-line JSDoc, `contextMaxChars: [1000, 200000]` to `INTEGER_LIMITS`, and read it in `normalizeConfig` the way the other integers are read.

In `lib/service.js`:
- extend the signature to `createService({ store, scanner, config, readSession, now = () => Date.now() })` and document `readSession`;
- add `getFailureContext(input = {})`:

```js
async function getFailureContext(input = {}) {
  const { sessionId, seq } = input
  if (typeof sessionId !== 'string' || sessionId.length === 0) throw new Error('failure-ledger: a context query needs a session id')
  if (!Number.isInteger(seq) || seq < 0) throw new Error('failure-ledger: a context query needs an event sequence number')
  if (typeof readSession !== 'function') throw new Error('failure-ledger: context queries need session access')
  const notFound = { found: false, sessionId, seq, sessionTitle: '', turn: 0, tool: '?', kind: '?', signature: '', line: '', entries: [], chars: 0, truncated: false, dropped: 0 }
  let observed
  try {
    observed = await readSession(sessionId)
  } catch {
    // The session can be rotated or deleted after the scan that recorded it.
    return notFound
  }
  const stored = store.data.sessions?.[sessionId]
  const failure = (stored?.failures ?? []).find((entry) => entry.seq === seq)
  const around = contextAround(observed?.events ?? [], seq, failure)
  const sessionTitle = observed?.session?.title ?? stored?.title ?? ''
  if (!around.found) return { ...notFound, sessionTitle }
  const requested = typeof input.maxChars === 'number' && input.maxChars > 0 ? input.maxChars : config.contextMaxChars
  const trimmed = trimEntries(around.entries, Math.min(requested, config.contextMaxChars))
  return {
    found: true, sessionId, seq, sessionTitle, turn: around.turn,
    tool: failure?.tool ?? '?', kind: failure?.kind ?? '?', signature: failure?.signature ?? '', line: failure?.line ?? '',
    entries: trimmed.entries, chars: trimmed.chars, truncated: trimmed.truncated, dropped: trimmed.dropped,
  }
}
```

- export it from the returned object: `return { getLedger, getGroup, getFailureContext, refresh, updatePrefs }`.

In `index.js`: `const source = createSource(ctx)` before the scanner, then `createService({ store, scanner, config, readSession: source.readSession })`.

In `lib/schemas.js` add `contextQuery`, `contextEntry`, `failureContext` as described in the spec (§4.1, loose objects, optional extras) and register `'ContextQuery'`, `'ContextEntry'`, `'FailureContext'` in `SCHEMAS`.

In `typert.js` add the invocation and member:

```js
invocation('getFailureContext', [rpcParam('input', 'ContextQuery')], 'FailureContext', 'Read the log around one failure'),
member('getFailureContext', 'getFailureContext(input: ContextQuery): Promise<FailureContext>', 'Read the log around one failure'),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/context.test.js test/config.test.js test/wire-roundtrip.test.js test/typert.test.js test/service.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/context.js lib/config.js lib/schemas.js lib/service.js typert.js index.js test/context.test.js test/config.test.js test/wire-roundtrip.test.js test/typert.test.js
git commit -m "feat: read the log around a recorded failure"
```

---

### Task 2: Ignore a group's failures before a baseline

**Files:**
- Modify: `lib/ledger-store.js` (completeLedger at 65-78; emptyLedger prefs), `lib/schemas.js` (prefs at 62-65, prefsPatch at 123-128), `lib/service.js` (`occurrencesOf` 113-135, `build` totals 242-249, `getGroup` 295-298, `updatePrefs` 334-366)
- Test: `test/service.test.js`, `test/ledger-store.test.js`, `test/wire-roundtrip.test.js`

**Interfaces:**
- Consumes: `occurrencesOf(sessions, query, prefs)` now honors `prefs.since`; `groupIdOf(tool, kind, signature)`.
- Produces: `prefs.since: Record<string, number>`; `PrefsPatch.since: [{ groupId, before }]`, `PrefsPatch.unsince: string[]`.

- [ ] **Step 1: Write the failing tests**

In `test/service.test.js` (helpers `failure`, `entry`, `fakeStore`, `makeService`, `THREE_AND_TWO` already exist):

```js
test('a baseline drops failures recorded before it', async () => {
  const boom = groupIdOf('bash', 'exit', 'boom')
  const { service } = makeService({ sessions: THREE_AND_TWO, prefs: { ignored: [], merge: {}, since: { [boom]: BASE - 2000 } } })
  const ledger = await service.getLedger()
  const bash = ledger.groups.find((group) => group.signature === 'boom')
  assert.equal(bash.count, 1)
  assert.equal(ledger.totals.failures, 3)
})

test('a group with only pre-baseline failures disappears', async () => {
  const gone = groupIdOf('edit', 'error', 'gone')
  const { service } = makeService({ sessions: THREE_AND_TWO, prefs: { ignored: [], merge: {}, since: { [gone]: BASE } } })
  const ledger = await service.getLedger()
  assert.equal(ledger.groups.some((group) => group.signature === 'gone'), false)
  assert.equal(ledger.totals.failures, 3)
})

test('no baseline keeps every failure', async () => {
  const { service } = makeService({ sessions: THREE_AND_TWO, prefs: { ignored: [], merge: {}, since: {} } })
  const ledger = await service.getLedger()
  assert.equal(ledger.totals.failures, 5)
})

test('a baseline on a merged target also drops its sources', async () => {
  const boom = groupIdOf('bash', 'exit', 'boom')
  const gone = groupIdOf('edit', 'error', 'gone')
  const { service } = makeService({
    sessions: THREE_AND_TWO,
    prefs: { ignored: [], merge: { [boom]: gone }, since: { [gone]: BASE - 2000 } },
  })
  const ledger = await service.getLedger()
  assert.equal(ledger.groups.length, 1)
  assert.equal(ledger.groups[0].count, 2)
  assert.equal(ledger.totals.failures, 2)
})

test('a baseline set on a merged source lands on its target', async () => {
  const boom = groupIdOf('bash', 'exit', 'boom')
  const gone = groupIdOf('edit', 'error', 'gone')
  const { service } = makeService({ sessions: THREE_AND_TWO, prefs: { ignored: [], merge: { [boom]: gone }, since: {} } })
  const updated = await service.updatePrefs({ since: [{ groupId: boom, before: BASE - 2000 }] })
  assert.equal(updated.prefs.since[gone], BASE - 2000)
  assert.equal(updated.prefs.since[boom], undefined)
})

test('a baseline hides old occurrences from getGroup but unsince restores them', async () => {
  const boom = groupIdOf('bash', 'exit', 'boom')
  const { service, store } = makeService({ sessions: THREE_AND_TWO, prefs: { ignored: [], merge: {}, since: { [boom]: BASE - 2000 } } })
  const group = await service.getGroup(boom)
  assert.equal(group.total, 1)
  assert.equal(group.occurrences.length, 1)
  const updated = await service.updatePrefs({ unsince: [boom] })
  assert.deepEqual(updated.prefs.since, {})
  const restored = await service.getGroup(boom)
  assert.equal(restored.total, 3)
  assert.equal(store.data.prefs.since[boom], undefined)
})

test('updatePrefs sets a baseline on an unknown group and validates the time', async () => {
  const { service } = makeService({ sessions: THREE_AND_TWO })
  const updated = await service.updatePrefs({ since: [{ groupId: 'later-group', before: BASE }] })
  assert.equal(updated.prefs.since['later-group'], BASE)
  await assert.rejects(() => service.updatePrefs({ since: [{ groupId: 'x', before: 0 }] }), /positive/)
  await assert.rejects(() => service.updatePrefs({ since: [{ groupId: '', before: BASE }] }), /group id/)
})

test('a poll with a matching revision still counts post-baseline totals', async () => {
  const boom = groupIdOf('bash', 'exit', 'boom')
  const { service, store } = makeService({ sessions: THREE_AND_TWO, prefs: { ignored: [], merge: {}, since: { [boom]: BASE - 2000 } } })
  const ledger = await service.getLedger({}, store.data.revision)
  assert.equal(ledger.unchanged, true)
  assert.equal(ledger.totals.failures, 3)
})
```

In `test/ledger-store.test.js`:

```js
test('an older ledger gains an empty since map', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'failure-ledger-store-'))
  const path = join(dir, 'ledger.json')
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, revision: 0, sessions: {}, prefs: { ignored: [], merge: {} } }))
  const store = await openLedger(path, { bootId: 'b', rulesVersion: RULES_VERSION })
  assert.deepEqual(store.data.prefs.since, {})
})
```

(Match the existing imports in that file; `writeFileSync`, `mkdtempSync`, `tmpdir`, `join`, `openLedger`, `RULES_VERSION` are already available or one-line additions.)

In `test/wire-roundtrip.test.js`:

```js
test('PrefsPatch carries baseline operations and rejects bad times', () => {
  const schema = schemaFor('PrefsPatch').create()
  assert.doesNotThrow(() => schema.parse({ since: [{ groupId: 'g1', before: 10 }] }))
  assert.doesNotThrow(() => schema.parse({ unsince: ['g1'] }))
  assert.throws(() => schema.parse({ since: [{ groupId: 'g1', before: 'soon' }] }))
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/service.test.js test/ledger-store.test.js test/wire-roundtrip.test.js`
Expected: FAIL — counts stay 3/2, `prefs.since` missing, schema rejects `since`.

- [ ] **Step 3: Implement baseline filtering in `lib/service.js`**

Add one helper next to `compareGroups`:

```js
function baselineOf(prefs, groupId) {
  const target = prefs?.merge?.[groupId] ?? groupId
  const since = prefs?.since?.[target]
  return typeof since === 'number' ? since : undefined
}
```

Change `occurrencesOf(sessions, query, prefs = {})`: compute `occurrence.groupId` before the filters, then `const since = baselineOf(prefs, occurrence.groupId); if (since !== undefined && occurrence.at <= since) continue` before `matches`.

Update every call site to pass `store.data.prefs ?? {}` (in `build`, `getGroup`, and the `updatePrefs` grouping pass). In `build`, read the preferences once at the top (`const prefs = store.data.prefs ?? { ignored: [], merge: {}, since: {} }`) and reuse `prefs.merge`/`prefs.ignored` instead of repeating the `store.data.prefs?.` lookups.

Replace the totals loop in `build` so it counts per failure with the same cutoff:

```js
for (const entry of Object.values(store.data.sessions)) {
  for (const failure of entry.failures ?? []) {
    const since = baselineOf(prefs, groupIdOf(failure.tool, failure.kind, failure.signature))
    if (since !== undefined && failure.at <= since) continue
    failures += 1
  }
  if (typeof entry.unknownOutcome === 'number') unknownOutcome += entry.unknownOutcome
  if (entry.scanError !== undefined) scanErrors += 1
}
```

- [ ] **Step 4: Implement the preference writes**

In `updatePrefs`, after the merge map is final:

```js
const since = { ...(prefs.since ?? {}) }
for (const entry of patch.since ?? []) {
  if (typeof entry?.groupId !== 'string' || entry.groupId.length === 0) throw new Error('failure-ledger: a baseline needs a non-empty group id')
  if (typeof entry.before !== 'number' || !Number.isFinite(entry.before) || entry.before <= 0) throw new Error('failure-ledger: a baseline needs a finite positive time')
  since[merge[entry.groupId] ?? entry.groupId] = entry.before
}
for (const groupId of patch.unsince ?? []) delete since[groupId]
prefs.since = since
```

In `lib/schemas.js`: `prefs` gains `since: z.record(z.string(), z.number()).optional()`; `prefsPatch` gains `since: z.array(z.looseObject({ groupId: z.string(), before: z.number() })).optional()` and `unsince: z.array(z.string()).optional()`.

In `lib/ledger-store.js`: `emptyLedger`'s prefs becomes `{ ignored: [], merge: {}, since: {} }`; `completeLedger` fills `parsed.prefs.since = {}` when it is not an object.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/service.test.js test/ledger-store.test.js test/wire-roundtrip.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/service.js lib/schemas.js lib/ledger-store.js test/service.test.js test/ledger-store.test.js test/wire-roundtrip.test.js
git commit -m "feat: ignore a group's failures before a baseline"
```

---

### Task 3: Expose turn, step and exit details per occurrence

**Files:**
- Modify: `lib/service.js` (`getGroup` projection at 303-316), `lib/schemas.js` (`occurrence` at 41-51)
- Test: `test/service.test.js`

**Interfaces:**
- Produces: `Occurrence.turn`, `.step`, `.exitCode`, `.signal`, `.timeoutMs`, `.errorCode`, each optional.

- [ ] **Step 1: Write the failing test**

```js
test('getGroup carries the failure details needed to inspect it', async () => {
  const sessions = {
    s1: entry([failure(BASE - 1000, 'bash', 'exit', 'boom', { turn: 4, step: 2, exitCode: 127, callId: 'c1' })]),
  }
  const { service } = makeService({ sessions })
  const group = await service.getGroup(groupIdOf('bash', 'exit', 'boom'))
  const [occurrence] = group.occurrences
  assert.equal(occurrence.turn, 4)
  assert.equal(occurrence.step, 2)
  assert.equal(occurrence.exitCode, 127)
  assert.equal(occurrence.callId, 'c1')
  assert.equal(occurrence.signal, undefined)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/service.test.js -t "getGroup carries"`
Expected: FAIL — `occurrence.turn` is undefined.

- [ ] **Step 3: Widen the projection**

In `getGroup`, add `turn: occurrence.turn ?? 0`, `step: occurrence.step ?? 0` to the row, then conditionally copy `exitCode`, `signal`, `timeoutMs`, `errorCode` the way `callId` already is. In `lib/schemas.js` add the same five optional fields to `occurrence`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/service.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/service.js lib/schemas.js test/service.test.js
git commit -m "feat: expose turn, step and exit details per occurrence"
```

---

### Task 4: Panel actions and the context viewer

**Files:**
- Modify: `src/client/01-core.js` (CONTRIBUTION at 129-137, SERVICE_METHODS at 159), `src/client/02-page.js` (GroupTable 288-374, GroupDetail 381-427, Page 467-633), `src/client/03-apply.js`, `locale/en.json`, `locale/zh.json`, `test/client-contribution.test.js`
- Test: `test/query-ui.test.js` (create)
- Rebuild: `lib/client.js` via `node scripts/build-client.js`

**Interfaces:**
- Consumes: `service.getFailureContext({ sessionId, seq })`; `updatePrefs({ since: [{ groupId, before }] })`.
- Produces: `GroupTable` prop `onBaseline(groupId)`; `GroupDetail` props `onContext(occurrence)`, `context`, `onCloseContext()`; `Page` state `context`.

- [ ] **Step 1: Write the failing client test**

`test/query-ui.test.js` follows `test/header-sort.test.js` exactly: `load()` concatenates `01-core.js` and `02-page.js` in a `vm` sandbox whose `React.createElement` flattens children, and ends with `({ GroupTable, GroupDetail })`; `plain(value)` normalizes cross-realm objects.

```js
test('a non-ignored row offers the baseline action', () => {
  const t = (key) => key
  const calls = []
  const group = { groupId: 'g1', tool: 'bash', kind: 'exit', signature: 'boom', count: 2, sessionCount: 1, lastAt: 0, ignored: false }
  const tree = load().GroupTable({ t, groups: [group], selected: [], sort: [{ key: 'count', dir: 'desc' }], activeId: undefined, onSort() {}, onToggle() {}, onOpen() {}, onMute() {}, onBaseline: (id) => calls.push(id) })
  const labels = []
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return
    if (typeof node.props?.onClick === 'function' && node.props.className === 'dsh-fl-link') labels.push(node.children[0])
    for (const child of node.children ?? []) walk(child)
  }
  walk(tree)
  assert.ok(labels.includes('action.baseline'))
  const button = findButton(tree, 'action.baseline')
  button.props.onClick()
  assert.deepEqual(calls, ['g1'])
})

test('an ignored row does not offer the baseline action', () => {
  const t = (key) => key
  const group = { groupId: 'g1', tool: 'bash', kind: 'exit', signature: 'boom', count: 2, sessionCount: 1, lastAt: 0, ignored: true }
  const tree = load().GroupTable({ t, groups: [group], selected: [], sort: [], onSort() {}, onToggle() {}, onOpen() {}, onMute() {}, onBaseline() {} })
  assert.equal(findButton(tree, 'action.baseline'), undefined)
})

test('each occurrence offers its context and the viewer renders the entries', () => {
  const t = (key, values) => (values === undefined ? key : key.replace(/\\{(\\w+)\\}/g, (_, name) => String(values[name])))
  const seen = []
  const occurrence = { at: 0, sessionId: 's1', sessionTitle: 'S', cwd: '/w', seq: 7, tool: 'bash', kind: 'error', line: 'boom', turn: 2, step: 2 }
  const group = { groupId: 'g1', tool: 'bash', kind: 'error', signature: 'boom', occurrences: [occurrence] }
  const detail = load().GroupDetail({ t, group, onClose() {}, onCopySession() {}, onContext: (value) => seen.push(value), onCloseContext() {} })
  findButton(detail, 'action.context').props.onClick()
  assert.deepEqual(seen, [occurrence])
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
```

`findButton(tree, label)` is a small local helper walking `{ type, props, children }` for a `button` whose first child equals `label`; write it once at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/query-ui.test.js`
Expected: FAIL — no baseline button, no context button.

- [ ] **Step 3: Add the descriptor and the client methods**

`src/client/01-core.js`: add to `CONTRIBUTION.descriptors`

```js
remoteMethod('getFailureContext', [rpcParam('input', 'ContextQuery', jsonCodec())], 'FailureContext', 'Read the log around one failure'),
```

and append `'getFailureContext'` to `SERVICE_METHODS`. Update `test/client-contribution.test.js`: the expected method string becomes `getFailureContext,getGroup,getLedger,refresh,updatePrefs`, the fake mounted service gains `getFailureContext`, and the descriptor argument-count test asserts `['input']` for it.

- [ ] **Step 4: Add the panel actions and the context block**

`GroupTable`: before the mute button in the last cell, render for `group.ignored !== true`:

```js
h('button', {
  type: 'button',
  className: 'dsh-fl-link',
  onClick: (event) => { event.stopPropagation(); props.onBaseline(group.groupId) },
}, t('action.baseline')),
```

`GroupDetail`: in each occurrence's meta row add a button `t('action.context')` calling `props.onContext(occurrence)`; after the `<ul>`, render the viewer when `props.context !== undefined`:

```js
h('section', { className: 'dsh-fl-context', 'aria-label': t('context.title') },
  h('header', { className: 'dsh-fl-context-header' },
    h('h3', { className: 'dsh-fl-context-title' }, t('context.title')),
    h('button', { type: 'button', className: 'dsh-fl-link', onClick: props.onCloseContext }, t('action.close'))),
  props.context.loading === true
    ? h('p', { className: 'dsh-fl-muted' }, t('context.loading'))
    : props.context.error !== undefined
      ? h('p', { className: 'dsh-fl-error', role: 'alert' }, t('context.failed'))
      : props.context.entries.length === 0
        ? h('p', { className: 'dsh-fl-muted' }, t('context.empty'))
        : h('div', { className: 'dsh-fl-context-entries' }, props.context.entries.map((entry, index) =>
            h('div', { key: String(index), className: 'dsh-fl-context-entry' },
              h('span', { className: 'dsh-fl-context-label dsh-fl-muted' }, entry.name === undefined ? entry.kind : entry.kind + ' · ' + entry.name),
              h('pre', { className: 'dsh-fl-context-text' }, entry.text)))),
  props.context.truncated === true
    ? h('p', { className: 'dsh-fl-muted' }, t('context.truncated').replace('{n}', String(props.context.dropped)))
    : null,
)
```

`Page`: add `const [context, setContext] = React.useState(undefined)`, clear it when the detail closes, and add

```js
async function loadContext(occurrence) {
  if (service === undefined) return
  setContext({ loading: true })
  try {
    const value = await service.getFailureContext({ sessionId: occurrence.sessionId, seq: occurrence.seq })
    setContext({ loading: false, entries: value.entries, truncated: value.truncated, dropped: value.dropped, chars: value.chars })
  } catch (error) {
    setContext({ loading: false, error, entries: [], truncated: false, dropped: 0, chars: 0 })
  }
}
```

Pass `context`, `onContext: loadContext`, `onCloseContext: () => setContext(undefined)` to `GroupDetail`, and give `GroupTable` `onBaseline: (groupId) => changePreferences({ since: [{ groupId, before: Date.now() }] })`.

- [ ] **Step 5: Add copy and styles**

`locale/en.json` and `locale/zh.json` gain the same keys in the same order:

| key | en | zh |
|---|---|---|
| `action.baseline` | Ignore before now | 从此刻起忽略 |
| `action.context` | View context | 查看上下文 |
| `context.title` | Turn context | 上下文 |
| `context.loading` | Loading context… | 正在读取上下文… |
| `context.failed` | Could not read the context | 无法读取上下文 |
| `context.empty` | No events in this turn | 该轮次没有事件 |
| `context.truncated` | {n} older entries dropped | 已丢弃较早的 {n} 条 |

`src/client/03-apply.js` adds `.dsh-fl-context` (top border, padding), `.dsh-fl-context-header` (flex, space-between, align-center), `.dsh-fl-context-entry` (margin), `.dsh-fl-context-label` (small, uppercase), `.dsh-fl-context-text` (`white-space: pre-wrap`, `margin: 0`, `max-height: 240px`, `overflow: auto`).

- [ ] **Step 6: Rebuild the bundle and run the client tests**

Run: `node scripts/build-client.js && node --test test/query-ui.test.js test/client-contribution.test.js test/client-bundle.test.js test/header-sort.test.js test/prefs-contract.test.js`
Expected: PASS, and `lib/client.js` now contains `dsh-fl-context` and `getFailureContext`.

- [ ] **Step 7: Commit**

```bash
git add src/client/01-core.js src/client/02-page.js src/client/03-apply.js locale/en.json locale/zh.json lib/client.js test/query-ui.test.js test/client-contribution.test.js
git commit -m "feat: show failure context and baseline actions in the panel"
```

---

### Task 5: Documentation and whole-tree verification

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-11-22-query-interfaces-design.md` (status line)
- Test: full suite

- [ ] **Step 1: Document the interfaces**

README: add a `## Querying from another plugin` section after the panel section, listing `getFailureContext`, the `prefs.since` baseline (including `updatePrefs({ since, unsince })` and the "counts restart at the baseline" rule), and the widened `getGroup` occurrence fields, each with a one-line `ctx.failureLedger.<method>` example. Update the panel section with the two new actions. Change the design doc status line to `已批准` if it is not already.

- [ ] **Step 2: Run the full suite and verify the bundle**

Run: `npm test`
Expected: all tests pass, `test/e2e-live.test.js` skipped without `FAILURE_LEDGER_E2E`.

Run: `node scripts/build-client.js && git diff --exit-code lib/client.js`
Expected: no diff.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/superpowers/specs/2026-11-22-query-interfaces-design.md
git commit -m "docs: document the ledger query interfaces"
```

- [ ] **Step 4: Restart the host and verify in the real panel**

Run: `/tmp/dsh-web-restart.sh` (it kills the process listening on 3080, waits for the port to free, and relaunches `dsh web` on 192.168.2.1:3080).
Expected: a new PID owns 192.168.2.1:3080 and `curl /` answers 401 (the auth challenge).

Then drive the headless browser (`/tmp/cdp.mjs`, cookie from `/tmp/fl-cookie.mjs`): open `http://192.168.2.1:3080/`, click `button[aria-label="Failure ledger"]`, click a signature cell to open the detail, click `查看上下文`/`View context`, and assert the context block lists entries whose last one is the failure line. Then close it, click `从此刻起忽略` on a row, and assert the row disappears and the failure total drops. Record the observed values in the final report; if the group was the only one with failures, assert the empty state instead.
