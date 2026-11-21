/**
 * Fold the latest logged session title out of a session's own events.
 *
 * The harness computes the same value from the last `session/title` event; a
 * plugin sees only service APIs, so the rule is restated here rather than
 * imported. Every caller already holds the full log, which keeps a scan from
 * paying a second corpus read per session.
 * @param events - Complete session log in ascending seq order.
 * @returns The latest title text, or an empty string when the log has none.
 */
export function foldTitle(events) {
  if (!Array.isArray(events)) return ''
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'session/title' && typeof event.data?.title === 'string') return event.data.title
  }
  return ''
}
