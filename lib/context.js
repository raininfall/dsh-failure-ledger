import { flattenContent } from './detect.js'

/**
 * Normalize one session event into a context entry.
 * @param event - Session event.
 * @param callNames - Tool names of calls made before this event.
 * @returns The entry, or undefined for events the reader does not render.
 */
function entryOf(event, callNames) {
  const data = event.data ?? {}
  switch (event.type) {
    case 'turn/start':
      return { kind: 'turn', text: `turn ${data.turn ?? 0}` }
    case 'user/message':
      return { kind: 'user', text: flattenContent(data.content) }
    case 'assistant/message':
      return { kind: 'assistant', text: flattenContent(data.message?.content) }
    case 'tool/call':
      return {
        kind: 'tool',
        name: data.name ?? '?',
        callId: data.callId,
        text: typeof data.arguments === 'string' ? data.arguments : '',
      }
    case 'tool/result': {
      const message = data.message
      if (message === null || typeof message !== 'object') return undefined
      return {
        kind: 'result',
        name: callNames.get(message.toolCallId) ?? '?',
        callId: message.toolCallId,
        isError: message.isError === true,
        text: flattenContent(message.content),
      }
    }
    case 'job/settled':
      return { kind: 'job', text: data.detail ?? data.label ?? data.status ?? '' }
    case 'tool/ptc-dispatch':
      return {
        kind: 'ptc',
        name: data.name ?? '?',
        isError: data.isError === true,
        text: flattenContent(data.content),
      }
    default:
      return undefined
  }
}

/**
 * Render the session log from the start of the turn that holds one failure.
 * @param events - Session events in sequence order.
 * @param seq - Sequence number of the failing event.
 * @param failure - Recorded failure for that event, or undefined when the ledger no longer has it.
 * @returns `{ found, turn, entries }`; `found` is false when no event carries `seq`.
 */
export function contextAround(events, seq, failure) {
  const index = events.findIndex((event) => event.seq === seq)
  if (index < 0) return { found: false, turn: 0, entries: [] }

  let start = 0
  for (let i = index; i >= 0; i -= 1) {
    if (events[i].type === 'turn/start') {
      start = i
      break
    }
  }

  const callNames = new Map()
  for (const event of events.slice(0, index)) {
    if (event.type === 'tool/call' && event.data?.callId !== undefined) {
      callNames.set(event.data.callId, event.data.name)
    }
  }

  const entries = []
  for (const event of events.slice(start, index + 1)) {
    const entry = entryOf(event, callNames)
    if (entry !== undefined) entries.push(entry)
  }
  if (failure !== undefined) {
    entries.push({ kind: 'failure', text: failure.line ?? '', name: failure.tool ?? '?' })
  }

  const turn = events[index].data?.turn ?? events[start].data?.turn ?? 0
  return { found: true, turn, entries }
}

/**
 * Bound a context to a character budget by dropping the oldest entries.
 * @param entries - Entries to bound, oldest first.
 * @param maxChars - Budget in characters.
 * @returns The kept entries plus their size and the drop count; the last entry is always kept.
 */
export function trimEntries(entries, maxChars) {
  let chars = entries.reduce((sum, entry) => sum + entry.text.length, 0)
  let start = 0
  while (chars > maxChars && entries.length - start > 1) {
    chars -= entries[start].text.length
    start += 1
  }
  return {
    entries: entries.slice(start),
    chars,
    dropped: start,
    truncated: start > 0 || chars > maxChars,
  }
}
