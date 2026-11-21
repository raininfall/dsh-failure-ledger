import { z } from 'zod'

/**
 * Wire schemas for the `failureLedger` remote.
 *
 * Each one is exposed through the `TYPERT` manifest as a strict codec whose
 * `create()` returns the zod schema itself, which is the shape the typert
 * gateway parses values with. Objects are loose on purpose: the ledger is a
 * local file, and a field added by a newer build must not make an older page
 * throw while the plugin is being linked by source.
 */

const failure = z.looseObject({
  at: z.number(),
  turn: z.number(),
  step: z.number(),
  seq: z.number(),
  tool: z.string(),
  kind: z.string(),
  signature: z.string(),
  line: z.string(),
  exitCode: z.number().optional(),
  signal: z.string().optional(),
  timeoutMs: z.number().optional(),
  errorCode: z.string().optional(),
  callId: z.string().optional(),
})

const groupRow = z.looseObject({
  groupId: z.string(),
  tool: z.string(),
  kind: z.string(),
  signature: z.string(),
  count: z.number(),
  sessionCount: z.number(),
  lastAt: z.number(),
  ignored: z.boolean(),
  mergedFrom: z.array(z.string()).optional(),
})

const occurrence = z.looseObject({
  at: z.number(),
  sessionId: z.string(),
  sessionTitle: z.string(),
  cwd: z.string(),
  seq: z.number(),
  tool: z.string(),
  kind: z.string(),
  line: z.string(),
  callId: z.string().optional(),
})

const totals = z.looseObject({
  failures: z.number(),
  groups: z.number(),
  sessions: z.number(),
  scanErrors: z.number(),
  unknownOutcome: z.number(),
  lastScanAt: z.number(),
})

const prefs = z.looseObject({
  ignored: z.array(z.string()),
  merge: z.record(z.string(), z.string()),
})

const notice = z.looseObject({ code: z.string() })

const ledgerResult = z.looseObject({
  revision: z.number(),
  unchanged: z.boolean(),
  scanning: z.boolean(),
  progress: z.object({ done: z.number(), total: z.number() }).nullish(),
  totals,
  groups: z.array(groupRow),
  prefs,
  notices: z.array(notice),
})

const groupResult = z.looseObject({
  groupId: z.string(),
  tool: z.string(),
  kind: z.string(),
  signature: z.string(),
  total: z.number(),
  occurrences: z.array(occurrence),
})

const scanSummary = z.looseObject({
  scanned: z.number(),
  skipped: z.number().optional(),
  failed: z.number().optional(),
  failures: z.number().optional(),
  durationMs: z.number().optional(),
})

const updateResult = z.looseObject({
  revision: z.number(),
  prefs,
})

const ledgerQuery = z.looseObject({
  from: z.number().optional(),
  to: z.number().optional(),
  tool: z.string().optional(),
  kinds: z.array(z.string()).optional(),
  sessionId: z.string().optional(),
  cwd: z.string().optional(),
  text: z.string().optional(),
  includeJobKilled: z.boolean().optional(),
  hideIgnored: z.boolean().optional(),
  sort: z
    .object({
      key: z.enum(['count', 'sessionCount', 'lastAt', 'tool', 'kind', 'signature']),
      dir: z.enum(['asc', 'desc']),
    })
    .optional(),
  limit: z.number().optional(),
})

const prefsPatch = z.looseObject({
  ignore: z.array(z.string()).optional(),
  unignore: z.array(z.string()).optional(),
  merge: z.array(z.looseObject({ from: z.string(), to: z.string() })).optional(),
  unmerge: z.array(z.string()).optional(),
})

const groupId = z.string()
const revision = z.number()
const count = z.number()
const flag = z.boolean()

const SCHEMAS = new Map([
  ['Failure', failure],
  ['GroupRow', groupRow],
  ['Occurrence', occurrence],
  ['Totals', totals],
  ['Prefs', prefs],
  ['Notice', notice],
  ['LedgerResult', ledgerResult],
  ['GroupResult', groupResult],
  ['ScanSummary', scanSummary],
  ['UpdatePrefsResult', updateResult],
  ['LedgerQuery', ledgerQuery],
  ['PrefsPatch', prefsPatch],
  ['GroupId', groupId],
  ['Revision', revision],
  ['Limit', count],
  ['Flag', flag],
])

/**
 * Build the strict codec the typert gateway and loader both expect.
 * @param name - Schema name; also the codec's type symbol suffix.
 * @param schema - The zod schema that parses values of that type.
 * @returns A strict codec whose `create()` returns the schema.
 */
function strictCodec(name, schema) {
  return {
    mode: 'strict',
    typeSymbol: `dsh-failure-ledger#${name}`,
    description: `dsh-failure-ledger ${name}`,
    name,
    schema,
    create: () => schema,
    encode: (value) => value,
    decode: (value) => schema.parse(value),
  }
}

/**
 * Look up a wire codec by name.
 * @param name - Schema name from the manifest.
 * @returns The codec, or undefined when the name is unknown.
 */
export function schemaFor(name) {
  const schema = SCHEMAS.get(name)
  return schema === undefined ? undefined : strictCodec(name, schema)
}

/**
 * Every schema, as the `TYPERT.schemas` entries the loader inspects.
 * @returns One codec per exported schema name.
 */
export function allSchemas() {
  return [...SCHEMAS.entries()].map(([name, schema]) => strictCodec(name, schema))
}

export { SCHEMAS }
