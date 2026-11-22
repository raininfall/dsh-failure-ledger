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

test('every renderable event kind becomes one entry and the rest are skipped', () => {
  const events = [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'user/message', { content: text('why') }),
    event(2, 'assistant/message', { turn: 1, step: 1, message: { content: text('because') }, stream: { stage: 'end' } }),
    event(3, 'job/settled', { detail: 'job 7 failed', label: 'test', status: 'failed' }),
    event(4, 'tool/ptc-dispatch', { name: 'read', isError: true, content: text('nope'), subCallId: 's1' }),
    event(5, 'turn/end', {}),
  ]
  const around = contextAround(events, 4, undefined)
  assert.deepEqual(around.entries.map((entry) => entry.kind), ['turn', 'user', 'assistant', 'job', 'ptc'])
  assert.equal(around.entries[1].text, 'why')
  assert.equal(around.entries[2].text, 'because')
  assert.equal(around.entries[3].text, 'job 7 failed')
  assert.equal(around.entries[4].name, 'read')
  assert.equal(around.entries[4].isError, true)
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
