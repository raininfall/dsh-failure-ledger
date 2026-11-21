import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Version of the on-disk ledger document. A file with a newer version is never
 * interpreted: the rules that produced its groups may differ from these.
 */
export const SCHEMA_VERSION = 1

/**
 * Create the empty ledger document for a fresh boot.
 * @param options - Boot identity and the signature rules version in use.
 * @returns A ledger with no sessions and no preferences overrides.
 */
export function emptyLedger({ bootId, rulesVersion }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    rulesVersion,
    revision: 0,
    bootId,
    updatedAt: 0,
    lastScanAt: 0,
    prefs: { ignored: [], merge: {} },
    sessions: {},
  }
}

/**
 * Preserve an unreadable ledger beside the original so a corrupt file can be
 * inspected instead of silently overwritten.
 * @param path - Ledger path.
 * @returns The backup path, or undefined when even the rename failed.
 */
function preserveCorrupt(path) {
  const stamp = new Date().toISOString().replaceAll(':', '-')
  const backup = `${path}.corrupt-${stamp}`
  try {
    renameSync(path, backup)
    return backup
  } catch {
    // The original stays in place; the caller still gets an empty ledger.
    return undefined
  }
}

/**
 * Replace an unreadable ledger with an empty one while recording where the
 * original went.
 * @param path - Ledger path.
 * @param options - Boot identity and the signature rules version in use.
 * @returns A fresh ledger carrying `recoveredCorrupt`.
 */
function corruptLedger(path, { bootId, rulesVersion }) {
  const backup = preserveCorrupt(path)
  const ledger = emptyLedger({ bootId, rulesVersion })
  ledger.recoveredCorrupt = { from: path, backup, at: Date.now() }
  return ledger
}

/**
 * Fill the fields a ledger written by an older or hand-edited version lacks.
 * @param parsed - Parsed ledger document.
 * @returns The completed document, mutated in place.
 */
function completeLedger(parsed) {
  if (parsed.prefs === undefined || parsed.prefs === null || typeof parsed.prefs !== 'object') {
    parsed.prefs = { ignored: [], merge: {} }
  }
  if (!Array.isArray(parsed.prefs.ignored)) parsed.prefs.ignored = []
  if (parsed.prefs.merge === undefined || parsed.prefs.merge === null || typeof parsed.prefs.merge !== 'object') {
    parsed.prefs.merge = {}
  }
  if (parsed.sessions === undefined || parsed.sessions === null || typeof parsed.sessions !== 'object') parsed.sessions = {}
  if (typeof parsed.revision !== 'number') parsed.revision = 0
  if (typeof parsed.updatedAt !== 'number') parsed.updatedAt = 0
  if (typeof parsed.lastScanAt !== 'number') parsed.lastScanAt = 0
  return parsed
}

/**
 * Open the ledger document, creating an empty one when absent.
 *
 * The document is small enough to hold in memory, so this is a read-once
 * store: every mutation happens on `data`, and only `save()` reaches disk.
 * @param path - Absolute ledger path.
 * @param options - Boot identity and the signature rules version in use.
 * @returns The store: its path, mutable data, `save()`, `touch()` and `isDirty()`.
 */
export async function openLedger(path, { bootId, rulesVersion }) {
  let data
  let text = null
  try {
    text = readFileSync(path, 'utf8')
  } catch (cause) {
    if (cause instanceof Error && cause.code !== 'ENOENT') throw cause
  }

  if (text === null) {
    data = emptyLedger({ bootId, rulesVersion })
  } else {
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      data = corruptLedger(path, { bootId, rulesVersion })
    }
    if (parsed !== undefined) {
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        data = corruptLedger(path, { bootId, rulesVersion })
      } else {
        if (typeof parsed.schemaVersion !== 'number') {
          data = corruptLedger(path, { bootId, rulesVersion })
        } else if (parsed.schemaVersion > SCHEMA_VERSION) {
          throw new Error(`failure-ledger: ledger.json schemaVersion ${parsed.schemaVersion} is newer than ${SCHEMA_VERSION}; this DSH build cannot read it`)
        } else {
          data = completeLedger(parsed)
          if (data.rulesVersion === undefined) data.rulesVersion = rulesVersion
          if (typeof data.bootId !== 'string') data.bootId = bootId
        }
      }
    }
  }

  let dirty = false

  /**
   * Mark the in-memory document as changed.
   */
  const touch = () => {
    dirty = true
  }

  /**
   * Report whether the in-memory document has unsaved changes.
   * @returns Whether `save()` has work to do.
   */
  const isDirty = () => dirty

  /**
   * Persist the document atomically and clear the dirty flag.
   * @returns Nothing; the revision in `data` is incremented before the write.
   */
  const save = async () => {
    data.revision += 1
    data.updatedAt = Date.now()
    mkdirSync(dirname(path), { recursive: true })
    const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`)
    renameSync(temporary, path)
    dirty = false
  }

  return { path, data, save, touch, isDirty }
}
