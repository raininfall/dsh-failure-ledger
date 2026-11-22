import { KINDS } from './detect.js'
import { contextAround, trimEntries } from './context.js'
import { groupIdOf } from './signature.js'

/**
 * Default bound on rows returned by `getLedger`, so a pathological ledger
 * cannot swamp the panel.
 */
const DEFAULT_GROUP_LIMIT = 100

/**
 * Ordering used when the request names none: most frequent group first.
 */
const DEFAULT_SORT = Object.freeze([Object.freeze({ key: 'count', dir: 'desc' })])

/**
 * Default bound on occurrences returned by `getGroup`.
 */
const DEFAULT_OCCURRENCE_LIMIT = 200

/**
 * Read one query field, treating `null` and `undefined` as "no filter".
 * @param query - Request query.
 * @param key - Field name.
 * @returns The field value or undefined.
 */
function field(query, key) {
  const value = query?.[key]
  return value === null ? undefined : value
}

/**
 * Compare two strings by UTF-16 code unit. The host has no locale authority,
 * so ordering must not depend on the caller's collation.
 * @param left - Left value.
 * @param right - Right value.
 * @returns Negative, zero or positive as `left` sorts before, equal to or after `right`.
 */
function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Canonical sort position of each failure kind; an unknown kind ranks after
 * every known one.
 */
const KIND_RANK = new Map(KINDS.map((kind, index) => [kind, index]))

/**
 * Per-key comparisons in ascending order; `dir` is applied by `compareGroups`.
 */
const COMPARATORS = {
  count: (left, right) => left.count - right.count,
  sessionCount: (left, right) => left.sessionCount - right.sessionCount,
  lastAt: (left, right) => left.lastAt - right.lastAt,
  tool: (left, right) => compareText(left.tool, right.tool),
  kind: (left, right) => (KIND_RANK.get(left.kind) ?? KINDS.length) - (KIND_RANK.get(right.kind) ?? KINDS.length),
  signature: (left, right) => compareText(left.signature, right.signature),
}

/**
 * Build the total order for the requested columns: each `{ key, dir }` in
 * turn, then fixed tie-breaks (count desc, lastAt desc, groupId asc) so equal
 * keys never leave the order to insertion.
 * @param sort - Requested columns in priority order; empty or missing means the default.
 * @returns Comparator over wire group rows.
 */
export function compareGroups(sort) {
  const columns = Array.isArray(sort) && sort.length > 0 ? sort : DEFAULT_SORT
  return (left, right) => {
    for (const column of columns) {
      const order = (column.dir === 'desc' ? -1 : 1) * COMPARATORS[column.key](left, right)
      if (order !== 0) return order
    }
    return right.count - left.count || right.lastAt - left.lastAt || compareText(left.groupId, right.groupId)
  }
}

/**
 * Whether a failure passes the request's occurrence-level filters.
 * @param occurrence - One failure with its session context.
 * @param query - Request query.
 * @returns Whether the occurrence is in scope.
 */
function matches(occurrence, query) {
  const from = field(query, 'from')
  const to = field(query, 'to')
  if (from !== undefined && occurrence.at < from) return false
  if (to !== undefined && occurrence.at > to) return false
  const tool = field(query, 'tool')
  if (tool !== undefined && occurrence.tool !== tool) return false
  const kinds = field(query, 'kinds')
  if (Array.isArray(kinds) && kinds.length > 0 && !kinds.includes(occurrence.kind)) return false
  const sessionId = field(query, 'sessionId')
  if (sessionId !== undefined && occurrence.sessionId !== sessionId) return false
  const cwd = field(query, 'cwd')
  if (cwd !== undefined && occurrence.cwd !== cwd) return false
  const includeJobKilled = field(query, 'includeJobKilled') ?? false
  if (!includeJobKilled && occurrence.kind === 'job-killed') return false
  const text = field(query, 'text')
  if (text !== undefined && text.length > 0) {
    const needle = text.toLowerCase()
    if (!occurrence.signature.toLowerCase().includes(needle) && !occurrence.line.toLowerCase().includes(needle)) return false
  }
  return true
}

/**
 * Read the baseline that hides a group's earlier failures.
 * @param prefs - Stored preferences.
 * @param groupId - Group whose baseline is wanted.
 * @returns The baseline timestamp, or undefined when the group has none.
 */
function baselineOf(prefs, groupId) {
  const target = prefs?.merge?.[groupId] ?? groupId
  const since = prefs?.since?.[target]
  return typeof since === 'number' ? since : undefined
}

/**
 * Expand stored failures into occurrences, applying the request filters.
 * @param sessions - Ledger sessions map.
 * @param query - Request query.
 * @param prefs - Stored preferences; a group's baseline drops its earlier failures.
 * @returns Occurrences in no particular order.
 */
function occurrencesOf(sessions, query, prefs = {}) {
  const occurrences = []
  for (const [sessionId, entry] of Object.entries(sessions)) {
    for (const failure of entry.failures ?? []) {
      const occurrence = {
        at: failure.at,
        sessionId,
        sessionTitle: entry.title ?? '',
        cwd: entry.cwd ?? '',
        seq: failure.seq,
        tool: failure.tool,
        kind: failure.kind,
        signature: failure.signature,
        line: failure.line,
      }
      if (failure.callId !== undefined) occurrence.callId = failure.callId
      occurrence.groupId = groupIdOf(failure.tool, failure.kind, failure.signature)
      const since = baselineOf(prefs, occurrence.groupId)
      if (since !== undefined && occurrence.at <= since) continue
      if (!matches(occurrence, query)) continue
      occurrences.push(occurrence)
    }
  }
  return occurrences
}

/**
 * Fold occurrences into group rows, then apply the stored merge preferences.
 * @param occurrences - Filtered occurrences.
 * @param mergePrefs - `prefs.merge`: source group id → target group id.
 * @param ignored - `prefs.ignored`.
 * @param notices - Notice list the merge problems are appended to.
 * @returns Group rows keyed by the id they were grouped under.
 */
function groupOf(occurrences, mergePrefs, ignored, notices) {
  const groups = new Map()
  for (const occurrence of occurrences) {
    const existing = groups.get(occurrence.groupId)
    if (existing === undefined) {
      groups.set(occurrence.groupId, {
        groupId: occurrence.groupId,
        tool: occurrence.tool,
        kind: occurrence.kind,
        signature: occurrence.signature,
        count: 1,
        sessions: new Set([occurrence.sessionId]),
        lastAt: occurrence.at,
        occurrences: [occurrence],
      })
      continue
    }
    existing.count += 1
    existing.sessions.add(occurrence.sessionId)
    if (occurrence.at > existing.lastAt) existing.lastAt = occurrence.at
    existing.occurrences.push(occurrence)
  }

  // One flat hop: a source folds into a target, and a target that is itself a
  // source stays folded under its own target only when that order is explicit.
  for (const [from, to] of Object.entries(mergePrefs ?? {})) {
    const source = groups.get(from)
    if (source === undefined) continue
    const target = groups.get(to)
    if (target === undefined) {
      notices.push({ code: 'merge-target-missing', from, to })
      groups.delete(from)
      continue
    }
    target.count += source.count
    target.lastAt = Math.max(target.lastAt, source.lastAt)
    for (const sessionId of source.sessions) target.sessions.add(sessionId)
    target.occurrences.push(...source.occurrences)
    target.mergedFrom = [...(target.mergedFrom ?? []), from]
    groups.delete(from)
  }

  for (const group of groups.values()) {
    group.sessionCount = group.sessions.size
    group.ignored = ignored.includes(group.groupId)
    delete group.sessions
  }
  return groups
}

/**
 * Project one internal group row onto the wire shape.
 * @param group - Internal group row.
 * @returns The row the client receives.
 */
function rowOf(group) {
  const row = {
    groupId: group.groupId,
    tool: group.tool,
    kind: group.kind,
    signature: group.signature,
    count: group.count,
    sessionCount: group.sessionCount,
    lastAt: group.lastAt,
    ignored: group.ignored,
  }
  if (group.mergedFrom !== undefined) row.mergedFrom = group.mergedFrom
  return row
}

/**
 * Create the failure ledger's query service over one ledger document.
 *
 * Grouping is derived on every read from the stored tool, kind and signature,
 * so group ids always reflect the rule version that produced them; only the
 * user's ignore and merge decisions persist.
 * @param options - Ledger store, scanner, resolved config, session reader and clock.
 * @returns The `failureLedger` service.
 */
export function createService({ store, scanner, config, readSession, now = () => Date.now() }) {
  /**
   * Build group rows for one request.
   * @param query - Request query.
   * @param notices - Notice list.
   * @returns Group rows plus the totals computed from the same pass.
   */
  function build(query, notices) {
    const prefs = store.data.prefs ?? { ignored: [], merge: {}, since: {} }
    const occurrences = occurrencesOf(store.data.sessions, query, prefs)
    const groups = groupOf(occurrences, prefs.merge ?? {}, prefs.ignored ?? [], notices)
    const hideIgnored = field(query, 'hideIgnored') ?? true
    let rows = [...groups.values()].map(rowOf).filter((row) => !hideIgnored || !row.ignored)
    const sort = field(query, 'sort') ?? DEFAULT_SORT
    rows.sort(compareGroups(sort))
    const limit = field(query, 'limit')
    if (typeof limit === 'number' && limit > 0) rows = rows.slice(0, limit)
    else rows = rows.slice(0, DEFAULT_GROUP_LIMIT)

    let failures = 0
    let unknownOutcome = 0
    let scanErrors = 0
    for (const entry of Object.values(store.data.sessions)) {
      for (const failure of entry.failures ?? []) {
        const since = baselineOf(prefs, groupIdOf(failure.tool, failure.kind, failure.signature))
        if (since !== undefined && failure.at <= since) continue
        failures += 1
      }
      if (typeof entry.unknownOutcome === 'number') unknownOutcome += entry.unknownOutcome
      if (entry.scanError !== undefined) scanErrors += 1
    }
    return {
      rows,
      totals: {
        failures,
        groups: rows.length,
        sessions: Object.keys(store.data.sessions).length,
        scanErrors,
        unknownOutcome,
        lastScanAt: store.data.lastScanAt ?? 0,
      },
    }
  }

  /**
   * Read the grouped ledger.
   * @param query - Optional filters, sort and limit.
   * @param knownRevision - Revision the caller already holds; when it matches, grouping is skipped.
   * @returns Ledger rows, totals, preferences and notices.
   */
  async function getLedger(query = {}, knownRevision = null) {
    // Polling for staleness is deliberate: the panel refreshes the ledger
    // without waiting for a scan, and the scan itself is scheduled elsewhere.
    if (typeof scanner.checkStale === 'function') void Promise.resolve(scanner.checkStale()).catch(() => {})
    const notices = []
    if (store.data.recoveredCorrupt !== undefined) {
      notices.push({ code: 'ledger-recovered', from: store.data.recoveredCorrupt.from, backup: store.data.recoveredCorrupt.backup })
    }
    const status = typeof scanner.status === 'function' ? scanner.status() : undefined
    const scanning = status?.scanning === true
    const progress = status?.progress ?? null
    const revision = store.data.revision
    if (knownRevision !== null && knownRevision !== undefined && knownRevision === revision) {
      const built = build(query, notices)
      return { revision, unchanged: true, scanning, progress, totals: built.totals, groups: [], prefs: store.data.prefs, notices }
    }
    const built = build(query, notices)
    return { revision, unchanged: false, scanning, progress, totals: built.totals, groups: built.rows, prefs: store.data.prefs, notices }
  }

  /**
   * Read one group's occurrences.
   * @param groupId - Group id from `getLedger`.
   * @param limit - Maximum occurrences returned.
   * @returns The group, its newest occurrences and its total count.
   */
  async function getGroup(groupId, limit = DEFAULT_OCCURRENCE_LIMIT) {
    const notices = []
    const prefs = store.data.prefs ?? { ignored: [], merge: {}, since: {} }
    const occurrences = occurrencesOf(store.data.sessions, { includeJobKilled: true, hideIgnored: false }, prefs)
    const groups = groupOf(occurrences, prefs.merge ?? {}, prefs.ignored ?? [], notices)
    const resolvedId = store.data.prefs?.merge?.[groupId] ?? groupId
    const group = groups.get(resolvedId)
    if (group === undefined) return { groupId, tool: '?', kind: '?', signature: '', total: 0, occurrences: [] }
    const sorted = [...group.occurrences].sort((left, right) => right.at - left.at)
    const rows = sorted.slice(0, typeof limit === 'number' && limit > 0 ? limit : DEFAULT_OCCURRENCE_LIMIT).map((occurrence) => {
      const row = {
        at: occurrence.at,
        sessionId: occurrence.sessionId,
        sessionTitle: occurrence.sessionTitle,
        cwd: occurrence.cwd,
        seq: occurrence.seq,
        tool: occurrence.tool,
        kind: occurrence.kind,
        line: occurrence.line,
      }
      if (occurrence.callId !== undefined) row.callId = occurrence.callId
      return row
    })
    return { groupId: group.groupId, tool: group.tool, kind: group.kind, signature: group.signature, total: group.count, occurrences: rows }
  }

  /**
   * Run one scan pass now.
   * @param full - Ignore fingerprints and rescan every session.
   * @returns The scan summary.
   */
  async function refresh(full = false) {
    return scanner.run({ full })
  }

  /**
   * Change the persisted ignore and merge decisions.
   * @param patch - `ignore`, `unignore`, `merge` and `unmerge` operations.
   * @returns The new revision and preferences.
   */
  async function updatePrefs(patch = {}) {
    const prefs = store.data.prefs ?? (store.data.prefs = { ignored: [], merge: {}, since: {} })
    const ignored = new Set(prefs.ignored ?? [])
    for (const groupId of patch.ignore ?? []) ignored.add(groupId)
    for (const groupId of patch.unignore ?? []) ignored.delete(groupId)

    const merge = { ...(prefs.merge ?? {}) }
    if (Array.isArray(patch.merge) && patch.merge.length > 0) {
      // Validation needs the current grouping, so it is derived on demand
      // rather than cached: a merge must relate two groups the ledger knows.
      const occurrences = occurrencesOf(store.data.sessions, { includeJobKilled: true, hideIgnored: false }, prefs)
      const groups = groupOf(occurrences, merge, [...ignored], [])
      for (const { from, to } of patch.merge) {
        if (typeof from !== 'string' || typeof to !== 'string' || from.length === 0 || to.length === 0) {
          throw new Error('failure-ledger: merge needs non-empty from and to group ids')
        }
        if (from === to) throw new Error('failure-ledger: a group cannot be merged into itself')
        const source = groups.get(from)
        const target = groups.get(to)
        if (source !== undefined && target !== undefined && (source.tool !== target.tool || source.kind !== target.kind)) {
          throw new Error('failure-ledger: merge requires the same tool and kind on both groups')
        }
        merge[from] = to
      }
    }
    for (const from of patch.unmerge ?? []) delete merge[from]

    const since = { ...(prefs.since ?? {}) }
    for (const entry of patch.since ?? []) {
      if (typeof entry?.groupId !== 'string' || entry.groupId.length === 0) {
        throw new Error('failure-ledger: a baseline needs a non-empty group id')
      }
      if (typeof entry.before !== 'number' || !Number.isFinite(entry.before) || entry.before <= 0) {
        throw new Error('failure-ledger: a baseline needs a finite positive time')
      }
      since[merge[entry.groupId] ?? entry.groupId] = entry.before
    }
    for (const groupId of patch.unsince ?? []) delete since[groupId]

    prefs.ignored = [...ignored]
    prefs.merge = merge
    prefs.since = since
    store.touch()
    await store.save()
    return { revision: store.data.revision, prefs: store.data.prefs }
  }

  /**
   * Read the log around one recorded failure.
   * @param input - Session id, event sequence number and optional character budget.
   * @returns The normalized turn context, or `found: false` when the failure is not readable.
   */
  async function getFailureContext(input = {}) {
    const { sessionId, seq } = input
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('failure-ledger: a context query needs a session id')
    }
    if (!Number.isInteger(seq) || seq < 0) {
      throw new Error('failure-ledger: a context query needs an event sequence number')
    }
    if (typeof readSession !== 'function') {
      throw new Error('failure-ledger: context queries need session access')
    }

    const notFound = {
      found: false,
      sessionId,
      seq,
      sessionTitle: '',
      turn: 0,
      tool: '?',
      kind: '?',
      signature: '',
      line: '',
      entries: [],
      chars: 0,
      truncated: false,
      dropped: 0,
    }
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
      found: true,
      sessionId,
      seq,
      sessionTitle,
      turn: around.turn,
      tool: failure?.tool ?? '?',
      kind: failure?.kind ?? '?',
      signature: failure?.signature ?? '',
      line: failure?.line ?? '',
      entries: trimmed.entries,
      chars: trimmed.chars,
      truncated: trimmed.truncated,
      dropped: trimmed.dropped,
    }
  }

  return { getLedger, getGroup, getFailureContext, refresh, updatePrefs }
}
