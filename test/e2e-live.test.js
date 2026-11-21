import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { openLedger } from '../lib/ledger-store.js'
import { createScanner } from '../lib/scanner.js'
import { createService } from '../lib/service.js'
import { CONFIG_DEFAULTS } from '../lib/config.js'
import { RULES_VERSION } from '../lib/signature.js'

const ENABLED = process.env.FAILURE_LEDGER_E2E === '1'
const SESSIONS_ROOT = process.env.FAILURE_LEDGER_SESSIONS ?? join(process.env.HOME ?? '', '.dsh', 'sessions')
const LIMIT = Number(process.env.FAILURE_LEDGER_E2E_LIMIT ?? '40')
const SESSION_FILE = /^session\.v\d+\.jsonl(?:\.zstd)?$/

/**
 * List the newest real session logs, newest first.
 * @param root - Session store root.
 * @param limit - Maximum files to return.
 * @returns Absolute paths with their modification time.
 */
function newestSessionFiles(root, limit) {
  const found = []
  for (const group of readdirSync(root, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    const groupPath = join(root, group.name)
    for (const session of readdirSync(groupPath, { withFileTypes: true })) {
      if (!session.isDirectory()) continue
      const sessionPath = join(groupPath, session.name)
      for (const file of readdirSync(sessionPath)) {
        if (!SESSION_FILE.test(file)) continue
        const path = join(sessionPath, file)
        found.push({ path, mtimeMs: statSync(path).mtimeMs })
      }
    }
  }
  found.sort((left, right) => right.mtimeMs - left.mtimeMs)
  return found.slice(0, limit)
}

/**
 * Read one session log into the shape the scanner consumes.
 * @param entry - Path and modification time.
 * @returns Header, events and durable fingerprint fields.
 */
function loadSession(entry) {
  const bytes = readFileSync(entry.path)
  const text = entry.path.endsWith('.zstd') ? zstdDecompressSync(bytes).toString('utf8') : bytes.toString('utf8')
  const records = []
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    records.push(JSON.parse(line))
  }
  const header = records.shift() ?? {}
  return {
    id: header.id ?? entry.path,
    header: { id: header.id ?? entry.path, cwd: header.cwd ?? '', createdAt: header.createdAt ?? 0 },
    events: records,
    sizeBytes: bytes.length,
    eventCount: records.length,
  }
}

/**
 * A source adapter over the real session files.
 * @param entries - Session log paths.
 * @returns `listSessions`, `stat`, `readSession` and `readTitle`.
 */
function fileSource(entries) {
  const cache = new Map()
  const load = (id) => {
    const cached = cache.get(id)
    if (cached !== undefined) return cached
    const entry = entries.find((candidate) => candidate.id === id)
    assert.ok(entry !== undefined, `unknown session ${id}`)
    const loaded = loadSession(entry)
    cache.set(id, loaded)
    return loaded
  }
  return {
    async listSessions() {
      return entries.map((entry) => ({ header: entry.header, live: false, persisted: true }))
    },
    async stat(id) {
      const loaded = load(id)
      return { eventCount: loaded.eventCount, sizeBytes: loaded.sizeBytes }
    },
    async readSession(id) {
      const loaded = load(id)
      return { inheritedEventCount: 0, events: loaded.events }
    },
    async readTitle() {
      return ''
    },
  }
}

test('the ledger folds real session logs without AI heuristics', { skip: !ENABLED && 'set FAILURE_LEDGER_E2E=1 to run' }, async () => {
  const files = newestSessionFiles(SESSIONS_ROOT, LIMIT)
  assert.ok(files.length > 0, `no session logs under ${SESSIONS_ROOT}`)
  const entries = files.map((entry) => {
    const loaded = loadSession(entry)
    return { id: loaded.id, header: loaded.header, path: entry.path }
  })
  const ledgerPath = join(mkdtempSync(join(tmpdir(), 'failure-ledger-e2e-')), 'ledger.json')
  const store = await openLedger(ledgerPath, { bootId: 'e2e', rulesVersion: RULES_VERSION })
  const scanner = createScanner({ source: fileSource(entries), store, config: { ...CONFIG_DEFAULTS, retentionDays: 3650 }, bootId: 'e2e' })
  const service = createService({ store, scanner, config: { ...CONFIG_DEFAULTS, retentionDays: 3650 } })

  const startedAt = Date.now()
  const scan = await scanner.run({ full: true })
  const elapsedMs = Date.now() - startedAt
  const result = await service.getLedger({ includeJobKilled: true })

  process.stdout.write(`\ne2e: ${scan.scanned} scanned, ${scan.failed} failed, ${scan.failures} failures, ${elapsedMs}ms\n`)
  for (const group of result.groups.slice(0, 20)) {
    process.stdout.write(`${group.count}x ${group.tool}|${group.kind}|${group.signature}\n`)
  }
  const bytes = statSync(ledgerPath).size
  process.stdout.write(`ledger: ${bytes} bytes\n`)

  assert.ok(scan.scanned > 0, 'at least one session must be scanned')
  assert.equal(scan.failed, 0, `every session must scan cleanly, had ${scan.failed} failures`)
  assert.ok(result.groups.length > 0, 'real logs must produce failure groups')
  assert.ok(result.totals.failures > 0, 'real logs must produce failure counts')
  assert.ok(result.totals.scanErrors < scan.scanned / 2, 'most sessions must scan without error')
  assert.ok(bytes < 5 * 1024 * 1024, `ledger must stay under 5MB, was ${bytes}`)

  for (const group of result.groups) {
    assert.ok(group.signature.length > 0, `group ${group.groupId} has an empty signature`)
    assert.ok(!/^(===|}|REMOTE|\])+$/.test(group.signature), `group ${group.groupId} has a noise-only signature: ${group.signature}`)
  }
})
