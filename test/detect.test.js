import test from 'node:test'
import assert from 'node:assert/strict'

import { KINDS, flattenContent, foldSession, readMarkers } from '../lib/detect.js'

const DAY = 86_400_000
const BASE = 1_760_000_000_000

function text(value) {
  return [{ type: 'text', text: value }]
}

function callEvent(seq, callId, name) {
  return { type: 'tool/call', seq, time: BASE + seq * 1000, data: { turn: 1, step: 1, callId, name } }
}

function resultEvent(seq, callId, body, { isError = false, error } = {}) {
  const data = {
    turn: 1,
    step: 1,
    message: { role: 'tool', id: `msg-${seq}`, toolCallId: callId, content: text(body), source: { kind: 'tool' } },
  }
  if (isError) data.message.isError = true
  if (error !== undefined) data.error = error
  return { type: 'tool/result', seq, time: BASE + seq * 1000, data }
}

function jobEvent(seq, detail, status, { toolCallId = null, finishedAt } = {}) {
  const data = { jobId: 'job-1', status, detail, producerReported: true, startedAt: BASE + seq * 1000 - 10 }
  if (toolCallId !== null) data.toolCall = { callId: toolCallId, rootCallId: toolCallId }
  if (finishedAt !== undefined) data.finishedAt = finishedAt
  return { type: 'job/settled', seq, time: BASE + seq * 1000, data }
}

function ptcEvent(seq, name, body, { isError = true } = {}) {
  return {
    type: 'tool/ptc-dispatch',
    seq,
    time: BASE + seq * 1000,
    data: { rootCallId: 'root', parentCallId: 'root:ptc:0', subCallId: 'root:ptc:1', name, arguments: {}, isError, content: text(body) },
  }
}

function fold(events, extra = {}) {
  return foldSession({
    session: { id: 's1', createdAt: 0, cwd: '/w' },
    inheritedEventCount: 0,
    events,
    retentionDays: 90,
    nowMs: BASE + DAY,
    ...extra,
  })
}

test('KINDS lists the recorded failure kinds', () => {
  assert.deepEqual(KINDS, ['error', 'exit', 'signal', 'timeout', 'job-failed', 'job-killed', 'ptc-error'])
})

test('flattenContent joins text blocks and ignores other blocks', () => {
  assert.equal(flattenContent([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }]), 'a\nb')
  assert.equal(flattenContent(undefined), '')
  assert.equal(flattenContent('raw'), 'raw')
})

test('readMarkers reads the bash renderer markers', () => {
  assert.deepEqual(readMarkers('[stderr]\nboom\n[exit code: 3]'), { exitCode: 3 })
  assert.deepEqual(readMarkers('[timed out after 60000ms]'), { timeoutMs: 60000 })
  assert.deepEqual(readMarkers('[killed by signal: SIGKILL]'), { signal: 'SIGKILL' })
  assert.deepEqual(readMarkers('[stopped: Canceled by user]'), { stopped: true })
  assert.deepEqual(readMarkers('plain'), {})
})

test('an isError result becomes one error record with its code', () => {
  const { failures, unknownOutcome } = fold([
    callEvent(1, 'call-1', 'edit'),
    resultEvent(2, 'call-1', 'Error: FS_EDIT_NOT_FOUND\nold_string not found', { isError: true, error: { name: 'ToolFailure', code: 'FS_EDIT_NOT_FOUND' } }),
  ])
  assert.equal(unknownOutcome, 0)
  assert.equal(failures.length, 1)
  const [failure] = failures
  assert.equal(failure.kind, 'error')
  assert.equal(failure.tool, 'edit')
  assert.equal(failure.errorCode, 'FS_EDIT_NOT_FOUND')
  assert.equal(failure.signature, "Error: FS_EDIT_NOT_FOUND")
  assert.equal(failure.callId, 'call-1')
  assert.equal(failure.at, BASE + 2000)
})

test('a non-zero exit code becomes one exit record', () => {
  const { failures } = fold([callEvent(1, 'call-1', 'bash'), resultEvent(2, 'call-1', '[stderr]\nboom\n[exit code: 3]')])
  assert.equal(failures.length, 1)
  assert.equal(failures[0].kind, 'exit')
  assert.equal(failures[0].exitCode, 3)
  assert.equal(failures[0].signature, 'boom')
})

test('timeout and signal markers outrank a plain error', () => {
  const timeout = fold([callEvent(1, 'c', 'bash'), resultEvent(2, 'c', 'ran out of time\n[timed out after 60000ms]', { isError: true })])
  assert.equal(timeout.failures[0].kind, 'timeout')
  assert.equal(timeout.failures[0].timeoutMs, 60000)
  const signal = fold([callEvent(1, 'c', 'bash'), resultEvent(2, 'c', 'killed\n[killed by signal: SIGKILL]', { isError: true })])
  assert.equal(signal.failures[0].kind, 'signal')
  assert.equal(signal.failures[0].signal, 'SIGKILL')
})

test('a completed job only fails when its detail carries a non-zero exit code', () => {
  const ok = fold([callEvent(1, 'call-1', 'bash'), jobEvent(2, 'exit code: 0', 'completed')])
  assert.equal(ok.failures.length, 0)
  const failed = fold([callEvent(1, 'call-1', 'bash'), jobEvent(2, 'exit code: 3', 'completed', { toolCallId: 'call-1' })])
  assert.equal(failed.failures.length, 1)
  assert.equal(failed.failures[0].kind, 'job-failed')
  assert.equal(failed.failures[0].exitCode, 3)
  assert.equal(failed.failures[0].tool, 'bash')
})

test('a killed job records its signal and reason', () => {
  const { failures } = fold([callEvent(1, 'call-1', 'bash'), jobEvent(2, 'signal: SIGTERM; Download stalled', 'killed')])
  assert.equal(failures.length, 1)
  assert.equal(failures[0].kind, 'job-killed')
  assert.equal(failures[0].signal, 'SIGTERM')
  assert.equal(failures[0].signature, 'Download stalled')
})

test('a job without a tool call is attributed to the job itself', () => {
  const { failures } = fold([jobEvent(2, 'exit code: 2', 'completed', { toolCallId: null })])
  assert.equal(failures[0].tool, 'job')
})

test('an unparseable failed job counts as an unknown outcome', () => {
  const { failures, unknownOutcome } = fold([jobEvent(2, 'max-tokens', 'failed')])
  assert.equal(failures.length, 0)
  assert.equal(unknownOutcome, 1)
})

test('a PTC sub-dispatch error is recorded by its sub-call name', () => {
  const { failures } = fold([ptcEvent(2, 'ops_grep', 'Error: unknown tool')])
  assert.equal(failures.length, 1)
  assert.equal(failures[0].kind, 'ptc-error')
  assert.equal(failures[0].tool, 'ops_grep')
})

test('PTC failures can be excluded by config', () => {
  const { failures } = fold([ptcEvent(2, 'ops_grep', 'Error: unknown tool')], { includePtcDispatch: false })
  assert.equal(failures.length, 0)
})

test('inherited events are never folded', () => {
  const { failures } = fold(
    [callEvent(1, 'call-1', 'bash'), resultEvent(2, 'call-1', '[stderr]\nboom\n[exit code: 1]'), callEvent(6, 'call-2', 'bash'), resultEvent(7, 'call-2', '[stderr]\nlate\n[exit code: 1]')],
    { inheritedEventCount: 5 },
  )
  assert.equal(failures.length, 1)
  assert.equal(failures[0].signature, 'late')
})

test('failures older than the retention window are dropped', () => {
  const events = [callEvent(1, 'c', 'bash'), resultEvent(2, 'c', '[stderr]\nboom\n[exit code: 1]')]
  const at = BASE + 2000
  assert.equal(fold(events, { nowMs: at + 90 * DAY }).failures.length, 1)
  assert.equal(fold(events, { nowMs: at + 90 * DAY + 1 }).failures.length, 0)
})

test('ignorePatterns drop matching signatures', () => {
  const events = [callEvent(1, 'c', 'bash'), resultEvent(2, 'c', '[stderr]\nnoise errno 2\n[exit code: 1]')]
  assert.equal(fold(events, { ignorePatterns: [/errno/] }).failures.length, 0)
  assert.equal(fold(events, { ignorePatterns: [/nomatch/] }).failures.length, 1)
})

test('line and signature stay bounded', () => {
  const long = `error: ${'y'.repeat(2000)}`
  const events = [callEvent(1, 'c', 'bash'), resultEvent(2, 'c', `[stderr]\n${long}\n[exit code: 1]`)]
  const [failure] = fold(events, { maxSignatureChars: 120 }).failures
  assert.ok(failure.line.length <= 400)
  assert.ok(failure.signature.length <= 120)
})
