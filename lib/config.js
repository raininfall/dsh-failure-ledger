import { isAbsolute } from 'node:path'

/**
 * Deployment defaults for the failure ledger plugin. Every value here is a
 * documented `cordis.yml` field; none of them is read from anywhere else.
 */
export const CONFIG_DEFAULTS = Object.freeze({
  /** Absolute ledger file path; undefined means `$DSH_HOME/storages/failure-ledger/ledger.json`. */
  ledgerPath: undefined,
  /** How long a recorded failure stays in the ledger, in days. */
  retentionDays: 90,
  /** Whether `apply` schedules one incremental scan shortly after startup. */
  scanOnStartup: true,
  /** How many sessions a single scan pass reads concurrently. */
  scanConcurrency: 4,
  /** Whether sessions created as subagents are scanned. */
  includeSubagents: true,
  /** Whether `tool/ptc-dispatch` failures are recorded. */
  includePtcDispatch: true,
  /** Regexes whose match on a normalized signature drops that failure. */
  ignorePatterns: Object.freeze([]),
  /** Upper bound for a normalized signature, in characters. */
  maxSignatureChars: 160,
  /** Character budget for one failure context response. */
  contextMaxChars: 20000,
})

const INTEGER_LIMITS = Object.freeze({
  retentionDays: [1, 3650],
  scanConcurrency: [1, 16],
  maxSignatureChars: [40, 400],
  contextMaxChars: [1000, 200000],
})

const BOOLEAN_KEYS = ['scanOnStartup', 'includeSubagents', 'includePtcDispatch']

/**
 * Reject one bad configuration value with the plugin's message prefix.
 * @param message - What is wrong and which value is accepted.
 */
function fail(message) {
  throw new Error(`failure-ledger: ${message}`)
}

/**
 * Read and validate one integer config field.
 * @param raw - Caller-supplied config object.
 * @param key - Field name.
 * @returns The validated integer, or the documented default when absent.
 */
function integerField(raw, key) {
  const value = raw[key]
  const [min, max] = INTEGER_LIMITS[key]
  if (value === undefined || value === null) return CONFIG_DEFAULTS[key]
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`config.${key} must be an integer in [${min}, ${max}] (got ${JSON.stringify(value)})`)
  }
  return value
}

/**
 * Read and validate one boolean config field.
 * @param raw - Caller-supplied config object.
 * @param key - Field name.
 * @returns The validated boolean, or the documented default when absent.
 */
function booleanField(raw, key) {
  const value = raw[key]
  if (value === undefined || value === null) return CONFIG_DEFAULTS[key]
  if (typeof value !== 'boolean') fail(`config.${key} must be a boolean (got ${JSON.stringify(value)})`)
  return value
}

/**
 * Validate `cordis.yml` configuration and freeze the resolved result.
 *
 * Unknown keys are ignored: a plugin config is not a schema registry, and
 * DSH passes opaque objects through. Known keys fail loud at load time.
 * @param raw - Caller-supplied config object, possibly undefined or null.
 * @returns Frozen config with `ignorePatterns` compiled to RegExps once.
 */
export function normalizeConfig(raw) {
  const source = raw === undefined || raw === null ? {} : raw
  if (typeof source !== 'object' || Array.isArray(source)) fail('config must be an object')

  const rawPath = source.ledgerPath
  if (rawPath !== undefined && rawPath !== null) {
    if (typeof rawPath !== 'string' || rawPath.length === 0 || !isAbsolute(rawPath)) {
      fail(`config.ledgerPath must be an absolute path (got ${JSON.stringify(rawPath)})`)
    }
  }

  const patterns = []
  const rawPatterns = source.ignorePatterns
  if (rawPatterns !== undefined && rawPatterns !== null) {
    if (!Array.isArray(rawPatterns)) fail('config.ignorePatterns must be an array of regular expression strings')
    for (const entry of rawPatterns) {
      if (typeof entry !== 'string' || entry.length === 0) {
        fail(`config.ignorePatterns contains a non-string or empty entry (${JSON.stringify(entry)})`)
      }
      try {
        patterns.push(new RegExp(entry))
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause)
        fail(`config.ignorePatterns entry ${JSON.stringify(entry)} is not a valid regular expression: ${reason}`)
      }
    }
  }

  const resolved = {
    ledgerPath: rawPath === undefined || rawPath === null ? undefined : rawPath,
    retentionDays: integerField(source, 'retentionDays'),
    scanOnStartup: booleanField(source, 'scanOnStartup'),
    scanConcurrency: integerField(source, 'scanConcurrency'),
    includeSubagents: booleanField(source, 'includeSubagents'),
    includePtcDispatch: booleanField(source, 'includePtcDispatch'),
    ignorePatterns: Object.freeze(patterns),
    maxSignatureChars: integerField(source, 'maxSignatureChars'),
    contextMaxChars: integerField(source, 'contextMaxChars'),
  }
  for (const key of BOOLEAN_KEYS) {
    if (typeof resolved[key] !== 'boolean') fail(`config.${key} resolved to a non-boolean`)
  }
  return Object.freeze(resolved)
}
