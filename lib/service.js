import { groupIdOf } from './signature.js'

/**
 * Default bound on rows returned by `getLedger`, so a pathological ledger
 * cannot swamp the panel.
 */
const DEFAULT_GROUP_LIMIT = 100

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
 * Expand stored failures into occurrences, applying the request filters.
 * @param sessions - Ledger sessions map.
 * @param query - Request query.
 * @returns Occurrences in no particular order.
 */
function occurrencesOf(sessions, query) {
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
      if (!matches(occurrence, query)) continue
      occurrence.groupId = groupIdOf(failure.tool, failure.kind, failure.signature)
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
 * @param options - Ledger store, scanner, resolved config and clock.
 * @returns The `failureLedger` service.
 */
export function createService({ store, scanner, config, now = () => Date.now() }) {
  /**
   * Build group rows for one request.
   * @param query - Request query.
   * @param notices - Notice list.
   * @returns Group rows plus the totals computed from the same pass.
   */
  function build(query, notices) {
    const occurrences = occurrencesOf(store.data.sessions, query)
    const groups = groupOf(occurrences, store.data.prefs?.merge ?? {}, store.data.prefs?.ignored ?? [], notices)
    const hideIgnored = field(query, 'hideIgnored') ?? true
    let rows = [...groups.values()].map(rowOf).filter((row) => !hideIgnored || !row.ignored)
    const sort = field(query, 'sort') ?? 'count'
    if (sort === 'last') rows.sort((left, right) => right.lastAt - left.lastAt || right.count - left.count)
    else rows.sort((left, right) => right.count - left.count || right.lastAt - left.lastAt)
    const limit = field(query, 'limit')
    if (typeof limit === 'number' && limit > 0) rows = rows.slice(0, limit)
    else rows = rows.slice(0, DEFAULT_GROUP_LIMIT)

    let failures = 0
    let unknownOutcome = 0
    let scanErrors = 0
    for (const entry of Object.values(store.data.sessions)) {
      failures += (entry.failures ?? []).length
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
    const scanning = typeof scanner.status === 'function' ? scanner.status().scanning === true : false
    const revision = store.data.revision
    if (knownRevision !== null && knownRevision !== undefined && knownRevision === revision) {
      const built = build(query, notices)
      return { revision, unchanged: true, scanning, totals: built.totals, groups: [], prefs: store.data.prefs, notices }
    }
    const built = build(query, notices)
    return { revision, unchanged: false, scanning, totals: built.totals, groups: built.rows, prefs: store.data.prefs, notices }
  }

  /**
   * Read one group's occurrences.
   * @param groupId - Group id from `getLedger`.
   * @param limit - Maximum occurrences returned.
   * @returns The group, its newest occurrences and its total count.
   */
  async function getGroup(groupId, limit = DEFAULT_OCCURRENCE_LIMIT) {
    const notices = []
    const occurrences = occurrencesOf(store.data.sessions, { includeJobKilled: true, hideIgnored: false })
    const groups = groupOf(occurrences, store.data.prefs?.merge ?? {}, store.data.prefs?.ignored ?? [], notices)
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
    const prefs = store.data.prefs ?? (store.data.prefs = { ignored: [], merge: {} })
    const ignored = new Set(prefs.ignored ?? [])
    for (const groupId of patch.ignore ?? []) ignored.add(groupId)
    for (const groupId of patch.unignore ?? []) ignored.delete(groupId)

    const merge = { ...(prefs.merge ?? {}) }
    if (Array.isArray(patch.merge) && patch.merge.length > 0) {
      // Validation needs the current grouping, so it is derived on demand
      // rather than cached: a merge must relate two groups the ledger knows.
      const occurrences = occurrencesOf(store.data.sessions, { includeJobKilled: true, hideIgnored: false })
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

    prefs.ignored = [...ignored]
    prefs.merge = merge
    store.touch()
    await store.save()
    return { revision: store.data.revision, prefs: store.data.prefs }
  }

  return { getLedger, getGroup, refresh, updatePrefs }
}
