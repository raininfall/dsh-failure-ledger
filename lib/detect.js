import { extractErrorLine, signatureOf } from './signature.js'

/**
 * Failure kinds this detector records. A kind is part of the group identity, so
 * it stays a closed list rather than a free-form label.
 */
export const KINDS = Object.freeze(['error', 'exit', 'signal', 'timeout', 'job-failed', 'job-killed', 'ptc-error'])

const EXIT_MARKER = /\[exit code: (-?\d+)\]/
const SIGNAL_MARKER = /\[killed by signal: ([\w.+-]+)\]/
const TIMEOUT_MARKER = /\[timed out after (\d+)ms\]/
const STOPPED_MARKER = /\[stopped: /
const JOB_EXIT_DETAIL = /^exit code: (\d+)$/
const JOB_SIGNAL_DETAIL = /^signal: ([\w.+-]+)(?:; (.*))?$/
const MAX_LINE_CHARS = 400

/**
 * Join a tool result's model-facing content into plain text.
 * @param content - Content blocks, or an already-flat string.
 * @returns Text blocks joined with newlines; non-text blocks are ignored.
 */
export function flattenContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  return parts.join('\n')
}

/**
 * Read the status markers the bash renderer appends to a result body.
 * @param text - Tool result text.
 * @returns Parsed markers; absent fields are omitted.
 */
export function readMarkers(text) {
  const markers = {}
  const exit = EXIT_MARKER.exec(text)
  if (exit !== null) markers.exitCode = Number(exit[1])
  const signal = SIGNAL_MARKER.exec(text)
  if (signal !== null) markers.signal = signal[1]
  const timeout = TIMEOUT_MARKER.exec(text)
  if (timeout !== null) markers.timeoutMs = Number(timeout[1])
  if (STOPPED_MARKER.test(text)) markers.stopped = true
  return markers
}

/**
 * Build one failure record, omitting absent optional fields so the stored JSON
 * stays compact.
 * @param fields - Core fields plus optional markers.
 * @returns The failure record.
 */
function failureOf(fields) {
  const failure = {
    at: fields.at,
    turn: fields.turn ?? 0,
    step: fields.step ?? 0,
    seq: fields.seq,
    tool: fields.tool,
    kind: fields.kind,
    signature: fields.signature,
    line: fields.line,
  }
  if (fields.exitCode !== undefined) failure.exitCode = fields.exitCode
  if (fields.signal !== undefined) failure.signal = fields.signal
  if (fields.timeoutMs !== undefined) failure.timeoutMs = fields.timeoutMs
  if (fields.errorCode !== undefined) failure.errorCode = fields.errorCode
  if (fields.callId !== undefined) failure.callId = fields.callId
  return failure
}

/**
 * Reduce one line of a failure into the record's `line` and `signature`,
 * applying the configured signature cap.
 * @param source - Text the signature is derived from.
 * @param options - Cap for the signature.
 * @returns The raw line and the normalized signature.
 */
function linesOf(source, { maxSignatureChars = 160 } = {}) {
  const line = extractErrorLine(source).slice(0, MAX_LINE_CHARS)
  return { line, signature: signatureOf(source, { maxChars: maxSignatureChars }) }
}

/**
 * Fold one session's events into failure records.
 *
 * A `tool/result` failure is classified before a plain error, because the bash
 * tool reports non-zero exits as normal results rather than `isError`. A
 * `job/settled` event reports a background job's own exit status in `detail`,
 * independently of its `status`, so `detail` is parsed before `status`.
 * @param input - Session identity, events and the effective config.
 * @returns Failure records (oldest first) and the count of unparseable job outcomes.
 */
export function foldSession(input) {
  const {
    events,
    inheritedEventCount = 0,
    retentionDays = 90,
    nowMs = Date.now(),
    includePtcDispatch = true,
    maxSignatureChars = 160,
    ignorePatterns = [],
  } = input
  const cutoff = nowMs - retentionDays * 86_400_000
  const signatureOptions = { maxSignatureChars }
  const callNames = new Map()
  const failures = []
  let unknownOutcome = 0

  const push = (at, source, fields) => {
    if (typeof at === 'number' && at < cutoff) return
    const { line, signature } = linesOf(source, signatureOptions)
    if (signature.length > 0 && ignorePatterns.some((pattern) => pattern.test(signature))) return
    failures.push(failureOf({ at, seq: fields.seq, turn: fields.turn, step: fields.step, tool: fields.tool, kind: fields.kind, line, signature, exitCode: fields.exitCode, signal: fields.signal, timeoutMs: fields.timeoutMs, errorCode: fields.errorCode, callId: fields.callId }))
  }

  for (const event of events) {
    const { type, data } = event
    const inherited = event.seq < inheritedEventCount
    if (type === 'tool/call') {
      if (data !== null && typeof data === 'object') callNames.set(data.callId, data.name)
      continue
    }
    if (inherited) continue

    if (type === 'tool/result') {
      const message = data?.message
      if (message === null || typeof message !== 'object') continue
      const body = flattenContent(message.content)
      const turn = data.turn
      const step = data.step
      const tool = callNames.get(message.toolCallId) ?? '?'
      const callId = message.toolCallId
      if (message.isError === true) {
        const markers = readMarkers(body)
        const kind = markers.timeoutMs !== undefined ? 'timeout' : markers.signal !== undefined ? 'signal' : 'error'
        const errorCode = data.error?.code ?? data.error?.name
        push(event.time, body, { seq: event.seq, turn, step, tool, kind, timeoutMs: markers.timeoutMs, signal: markers.signal, errorCode, callId })
        continue
      }
      const markers = readMarkers(body)
      if (markers.exitCode !== undefined && markers.exitCode > 0) {
        push(event.time, body, { seq: event.seq, turn, step, tool, kind: 'exit', exitCode: markers.exitCode, callId })
      }
      continue
    }

    if (type === 'job/settled') {
      const detail = typeof data?.detail === 'string' ? data.detail : ''
      const at = typeof data?.finishedAt === 'number' ? data.finishedAt : event.time
      const tool = data?.toolCall === undefined ? 'job' : (callNames.get(data.toolCall.callId) ?? '?')
      const callId = data?.toolCall?.callId
      const signalDetail = JOB_SIGNAL_DETAIL.exec(detail)
      if (signalDetail !== null) {
        push(at, signalDetail[2] ?? detail, { seq: event.seq, tool, kind: 'job-killed', signal: signalDetail[1], callId })
        continue
      }
      const exitDetail = JOB_EXIT_DETAIL.exec(detail)
      if (exitDetail !== null) {
        const exitCode = Number(exitDetail[1])
        if (exitCode !== 0) push(at, detail, { seq: event.seq, tool, kind: 'job-failed', exitCode, callId })
        continue
      }
      if (data?.status === 'killed') {
        push(at, detail, { seq: event.seq, tool, kind: 'job-killed', callId })
        continue
      }
      if (data?.status === 'failed') {
        // A failed job whose detail carries no exit status or signal has no
        // signature to group by; the counter keeps it visible as a total only.
        unknownOutcome += 1
      }
      continue
    }

    if (type === 'tool/ptc-dispatch') {
      if (!includePtcDispatch) continue
      if (data === null || typeof data !== 'object' || data.isError !== true) continue
      const body = flattenContent(data.content)
      push(event.time, body, { seq: event.seq, tool: data.name, kind: 'ptc-error', errorCode: data.error?.code ?? data.error?.name, callId: data.subCallId })
    }
  }

  return { failures, unknownOutcome }
}
