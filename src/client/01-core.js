/**
 * Shared leaf helpers for the failure ledger's client bundle.
 *
 * This fragment is concatenated into the single-file bundle inside the
 * module loader factory, so it declares no exports and imports nothing.
 */

/** Panel id shared by the sidebar entry and the keyed main panel. */
const PANEL_ID = 'failure-ledger'

/** Locale namespace owned by this plugin. */
const NS = 'dsh-failure-ledger'

/**
 * Wrap a parse function as a codec the remote contribution accepts.
 * @param parse - Function returning a value or throwing.
 * @returns The codec object.
 */
function codecOf(parse) {
  return { parse }
}

/**
 * Build the strict codec a hand-written remote contribution needs.
 * @param name - Schema name.
 * @param schema - Object carrying the actual `parse`.
 * @returns A strict codec over that schema.
 */
function strictCodec(name, schema) {
  return { mode: 'strict', typeSymbol: 'dsh-failure-ledger#' + name, schema, create: () => schema }
}

/**
 * Describe one JSON parameter for the remote contribution.
 * @param name - Wire and argument name.
 * @param type - Schema name.
 * @param schema - Object carrying `parse`.
 * @param optional - Whether undefined is accepted.
 * @returns The parameter descriptor.
 */
function rpcParam(name, type, schema, optional = false) {
  return { name, wire: name, source: 'json', codec: strictCodec(type, schema), ...(optional ? { acceptsUndefined: true } : {}) }
}

/**
 * Format a count for display.
 * @param value - Count.
 * @returns The number, or `0` for a non-finite input.
 */
function formatCount(value) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '0'
}

/**
 * Describe how long ago something happened.
 * @param at - Epoch milliseconds.
 * @param translate - Locale lookup.
 * @param now - Clock, for tests.
 * @returns A short relative phrase in the active locale.
 */
function formatRelativeTime(at, translate, now) {
  const current = typeof now === 'number' ? now : Date.now()
  const delta = Math.max(0, current - at)
  const minutes = Math.floor(delta / 60000)
  if (minutes < 1) return translate('time.now')
  if (minutes < 60) return translate('time.minutes').replace('{n}', String(minutes))
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return translate('time.hours').replace('{n}', String(hours))
  const days = Math.floor(hours / 24)
  return translate('time.days').replace('{n}', String(days))
}

/**
 * Resolve the display name of one failure kind.
 * @param kind - One of the seven ledger kinds.
 * @param translate - Locale lookup.
 * @returns The localized label, falling back to the raw kind.
 */
function kindLabel(kind, translate) {
  const translated = translate('kind.' + kind)
  return translated === 'kind.' + kind ? kind : translated
}
