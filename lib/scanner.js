import { foldSession } from './detect.js'

/**
 * Run `worker` over `items` with at most `limit` in flight, preserving order.
 * @param items - Work items.
 * @param limit - Maximum concurrent workers.
 * @param worker - Async function applied to each item.
 * @returns Worker results in input order.
 */
async function mapPool(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  const width = Math.max(1, Math.min(limit, items.length))
  const runners = Array.from({ length: width }, async () => {
    while (true) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

/**
 * Decide whether a stored session entry still matches the persistence layer's
 * cheap snapshot of that session.
 *
 * `revision` is only comparable within one service instance, so it is trusted
 * only while `bootId` is unchanged; `eventCount` and `sizeBytes` are durable
 * and need both to be present on both sides.
 * @param stored - Stored session entry, if any.
 * @param snapshot - `sessionPersistence.stat()` snapshot.
 * @param bootId - Boot identity of the running host.
 * @returns Whether the session can be skipped.
 */
function fingerprintClean(stored, snapshot, bootId) {
  if (stored === undefined) return false
  const { fingerprint } = stored
  if (fingerprint === undefined) return false
  if (bootId !== undefined && fingerprint.bootId === bootId && fingerprint.revision !== undefined && snapshot.revision !== undefined && fingerprint.revision === snapshot.revision) return true
  const durable = fingerprint.eventCount !== undefined && fingerprint.sizeBytes !== undefined
  if (!durable) return false
  return fingerprint.eventCount === snapshot.eventCount && fingerprint.sizeBytes === snapshot.sizeBytes
}

/**
 * Create the incremental scanner over DSH sessions.
 *
 * All session access arrives through `source`, so the scanner is testable
 * without a live session store, and every write goes through `store`, which
 * owns the ledger document.
 * @param options - Dependencies: session source, ledger store, config, boot id.
 * @returns The scanner: `run`, `checkStale`, `status` and `schedule`.
 */
export function createScanner({ source, store, config, bootId, now = () => Date.now(), onProgress }) {
  let scanning = false
  let lastRun = null
  let timer = null
  let pending = null
  const stale = new Set()

  /**
   * Drop failures that fell out of the retention window.
   * @param cutoff - Oldest instant (ms) a kept failure may carry.
   */
  function prune(cutoff) {
    for (const entry of Object.values(store.data.sessions)) {
      if (!Array.isArray(entry.failures)) continue
      const kept = entry.failures.filter((failure) => typeof failure.at !== 'number' || failure.at >= cutoff)
      if (kept.length !== entry.failures.length) entry.failures = kept
    }
  }

  /**
   * Count every failure currently stored.
   * @returns Total failure records.
   */
  function countFailures() {
    let total = 0
    for (const entry of Object.values(store.data.sessions)) {
      if (Array.isArray(entry.failures)) total += entry.failures.length
    }
    return total
  }

  /**
   * Scan the sessions whose stored fingerprint no longer matches.
   * @param options - `full` ignores fingerprints; `signal` aborts the pass.
   * @returns Scan counters and the ledger's failure total.
   */
  async function run({ full = false, signal } = {}) {
    const startedAt = Date.now()
    if (scanning) return { scanned: 0, skipped: 0, failed: 0, failures: countFailures(), durationMs: 0, busy: true }
    scanning = true
    try {
      const nowMs = now()
      prune(nowMs - config.retentionDays * 86_400_000)
      const records = await source.listSessions(signal)
      // Sessions deleted from disk are dropped so the index cannot grow with
      // entries that no longer have a log behind them. The listing is the whole
      // store, so absence means gone rather than merely unreadable.
      const listed = new Set(records.map((record) => record.header.id))
      for (const id of Object.keys(store.data.sessions)) if (!listed.has(id)) delete store.data.sessions[id]
      const candidates = []
      let skipped = 0
      const targets = full ? records : await selectDirty(records, signal, (dirty) => { if (!dirty) skipped += 1 })
      skipped = records.length - targets.length - countSubagentSkipped(records, targets)
      for (const record of targets) candidates.push(record)

      let scanned = 0
      let failed = 0
      let done = 0
      const total = candidates.length
      const report = () => {
        if (typeof onProgress === 'function') onProgress({ done, total })
      }
      if (total === 0) report()

      await mapPool(candidates, config.scanConcurrency, async (record) => {
        const id = record.header.id
        try {
          const snapshot = await source.readSession(id, signal)
          const title = await source.readTitle(id, signal)
          const folded = foldSession({
            session: snapshot.session,
            inheritedEventCount: snapshot.inheritedEventCount ?? 0,
            events: snapshot.events ?? [],
            retentionDays: config.retentionDays,
            nowMs,
            includePtcDispatch: config.includePtcDispatch,
            maxSignatureChars: config.maxSignatureChars,
            ignorePatterns: config.ignorePatterns,
          })
          const stat = await source.stat(id)
          store.data.sessions[id] = {
            fingerprint: {
              bootId,
              revision: stat?.revision,
              eventCount: stat?.eventCount,
              sizeBytes: stat?.sizeBytes,
            },
            scannedAt: nowMs,
            cwd: snapshot.session?.cwd ?? record.header.cwd ?? '',
            title: typeof title?.title === 'string' ? title.title : '',
            inheritedEventCount: snapshot.inheritedEventCount ?? 0,
            failures: folded.failures,
          }
          if (folded.unknownOutcome > 0) store.data.sessions[id].unknownOutcome = folded.unknownOutcome
          scanned += 1
        } catch (cause) {
          failed += 1
          const message = cause instanceof Error ? cause.message : String(cause)
          const previous = store.data.sessions[id]
          store.data.sessions[id] = {
            ...(previous ?? { fingerprint: {}, scannedAt: nowMs, cwd: record.header.cwd ?? '', title: '', inheritedEventCount: 0, failures: [] }),
            scanError: message,
          }
        }
        done += 1
        report()
      })

      store.data.lastScanAt = nowMs
      store.touch()
      await store.save()
      lastRun = { scanned, skipped, failed, failures: countFailures(), durationMs: Date.now() - startedAt }
      return lastRun
    } finally {
      scanning = false
    }
  }

  /**
   * Count sessions excluded because they are subagent sessions.
   * @param records - All listed session records.
   * @param targets - Records selected for scanning.
   * @returns How many records were excluded for being subagents.
   */
  function countSubagentSkipped(records, targets) {
    const targetIds = new Set(targets.map((record) => record.header.id))
    let count = 0
    for (const record of records) {
      if (!targetIds.has(record.header.id) && record.header.origin === 'subagent') count += 1
    }
    return count
  }

  /**
   * Select the session records that need a scan.
   * @param records - Listed session records.
   * @param signal - Abort signal.
   * @param onVerdict - Called once per considered record with its dirtiness.
   * @returns Records to scan.
   */
  async function selectDirty(records, signal, onVerdict) {
    const targets = []
    for (const record of records) {
      if (signal?.aborted === true) break
      if (!config.includeSubagents && record.header.origin === 'subagent') {
        onVerdict(true)
        continue
      }
      const id = record.header.id
      let snapshot
      try {
        snapshot = await source.stat(id, signal)
      } catch {
        targets.push(record)
        onVerdict(true)
        continue
      }
      const clean = !stale.has(id) && fingerprintClean(store.data.sessions[id], snapshot ?? {}, bootId)
      onVerdict(!clean)
      if (!clean) targets.push(record)
    }
    return targets
  }

  /**
   * Cheap stationary check: statistically inspect up to `maxStats` sessions and
   * remember which ones need a scan.
   * @param options - `maxStats` bounds the number of `stat` calls; `signal` aborts.
   * @returns Whether any session needs a scan.
   */
  async function checkStale({ maxStats = 400, signal } = {}) {
    const records = await source.listSessions(signal)
    let checked = 0
    for (const record of records) {
      if (checked >= maxStats || signal?.aborted === true) break
      checked += 1
      const id = record.header.id
      try {
        const snapshot = await source.stat(id, signal)
        if (fingerprintClean(store.data.sessions[id], snapshot ?? {}, bootId)) stale.delete(id)
        else stale.add(id)
      } catch {
        stale.add(id)
      }
    }
    return stale.size > 0
  }

  /**
   * Report the scanner's current state.
   * @returns Whether a pass is running, the last pass summary and queued ids.
   */
  function status() {
    return { scanning, lastRun, stale: [...stale] }
  }

  /**
   * Request one run shortly, collapsing repeated requests into that run.
   * @param options - `delayMs` delays the pass so bursts of activity coalesce.
   * @returns The scheduled run's promise (the same promise for every coalesced call).
   */
  function schedule({ delayMs = 3000 } = {}) {
    if (pending !== null) return pending
    pending = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        timer = null
        pending = null
        run().then(resolve, reject)
      }, delayMs)
    })
    return pending
  }

  return { run, checkStale, status, schedule }
}
