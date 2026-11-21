import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { normalizeConfig } from './lib/config.js'
import { openLedger } from './lib/ledger-store.js'
import { createScanner } from './lib/scanner.js'
import { createService } from './lib/service.js'
import { RULES_VERSION } from './lib/signature.js'

/**
 * Plugin name, as it appears in the loader's config and in this manifest.
 */
export const name = 'failure-ledger'

/**
 * Services the plugin reads from. Both are provided by the base bundle, and
 * neither is optional: without them the ledger has nothing to scan.
 */
export const inject = ['sessionQuery', 'sessionPersistence']

/**
 * Starting delay of the first scan after the profile comes up. Short enough
 * that the panel is populated on first open, long enough not to compete with
 * the boot's own session reads.
 */
const STARTUP_SCAN_DELAY_MS = 5000

/**
 * Cordis service key and Typert namespace of the ledger query service. The
 * plugin manifest, the client contribution and the gateway binding all have to
 * agree on it.
 */
const SERVICE_KEY = 'failureLedger'

/**
 * Resolve the DSH home the ledger lives under when no path is configured.
 * @returns The configured DSH home, `$DSH_HOME`, or `~/.dsh`.
 */
function resolveHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.trim().length > 0) return configured
  return join(homedir(), '.dsh')
}

/**
 * Build the session-facing half of the scanner from the harness services.
 * @param ctx - Plugin context carrying `sessionQuery` and `sessionPersistence`.
 * @returns The scanner's data source.
 */
function createSource(ctx) {
  const query = ctx.sessionQuery
  const persistence = ctx.sessionPersistence
  return {
    /**
     * List recorded sessions, newest first.
     * @returns Every readable session record.
     */
    async listSessions() {
      return query.listSessions()
    },
    /**
     * Read one session's persistence snapshot for fingerprinting.
     * @param sessionId - Session to stat.
     * @returns The snapshot, or undefined when the store has none.
     */
    async stat(sessionId) {
      return persistence.stat(sessionId)
    },
    /**
     * Read one session's complete log.
     *
     * `observeSession` opens the stored log directly, while `readSession`
     * re-lists the whole persistence store first -- a listing per session,
     * which made a pass over a few dozen sessions take tens of minutes.
     * @param sessionId - Session to read.
     * @param signal - Optional cancellation for the stored-log read.
     * @returns The session header, inherited prefix length, and events.
     */
    async readSession(sessionId, signal) {
      const observation = await query.observeSession(sessionId, signal === undefined ? {} : { signal })
      try {
        return {
          session: observation.header,
          inheritedEventCount: observation.inheritedEventCount,
          events: observation.events,
        }
      } finally {
        observation[Symbol.dispose]()
      }
    },
  }
}

/**
 * Register the failure ledger plugin.
 *
 * The ledger file is opened, the scanner is wired to the harness's session
 * store, and the query service is provided as `failureLedger`. Nothing scans
 * synchronously: the first pass is deferred so the profile finishes booting.
 * @param ctx - Plugin context.
 * @param rawConfig - Optional plugin configuration, validated by `normalizeConfig`.
 */
export async function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const ledgerPath = config.ledgerPath ?? join(resolveHome(), 'storages', 'failure-ledger', 'ledger.json')
  mkdirSync(dirname(ledgerPath), { recursive: true })
  const bootId = randomUUID()
  const isNew = !existsSync(ledgerPath)
  const store = await openLedger(ledgerPath, { bootId, rulesVersion: RULES_VERSION })
  if (isNew) await store.save()
  const scanner = createScanner({ source: createSource(ctx), store, config, bootId })
  const service = createService({ store, scanner, config })

  // The gateway reaches a Host service only through this visible binding. Without
  // it every `failureLedger/*` call is refused as "no visible typertRemote
  // binding" before the method runs, even though the typert manifest is loaded.
  Object.defineProperty(service, 'typertRemote', {
    value: Object.freeze({ service, serviceKey: SERVICE_KEY, namespace: SERVICE_KEY }),
    enumerable: false,
  })

  ctx.provide(SERVICE_KEY, service)

  ctx.effect(() => {
    let timer
    if (config.scanOnStartup) {
      timer = setTimeout(() => {
        timer = undefined
        scanner.schedule().catch((error) => {
          // The panel shows the ledger, not the host log: a startup pass that
          // fails here has to leave a trace somewhere the user can find.
          ctx.logger?.warn?.(`failure-ledger: startup scan failed: ${error instanceof Error ? error.message : String(error)}`)
        })
      }, STARTUP_SCAN_DELAY_MS)
      timer.unref?.()
    }
    return () => {
      if (timer !== undefined) clearTimeout(timer)
    }
  }, 'failure-ledger: startup scan')

  ctx.effect(() => () => {
    // A ledger left dirty by the last scan would be rescanned in full on the
    // next boot; flushing on dispose keeps that cost off the next startup.
    if (store.isDirty()) store.save().catch(() => {})
  }, 'failure-ledger: persist ledger')
}
