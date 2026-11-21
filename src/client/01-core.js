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

/** Every failure kind the ledger can produce, in display order. */
const KINDS = ['error', 'exit', 'signal', 'timeout', 'job-failed', 'job-killed', 'ptc-error']

/**
 * A codec that accepts any JSON value unchanged.
 *
 * The host validates every request and result against its own schemas, so the
 * client only needs a parse function of the right shape; duplicating those
 * schemas here would mean two places to keep in step.
 * @returns The passthrough codec.
 */
function jsonCodec() {
  return codecOf(function pass(value) {
    return value
  })
}

/**
 * Describe one remote method.
 * @param method - Method name on the provided service.
 * @param parameters - Parameter descriptors.
 * @param resultType - Schema name for the result.
 * @returns The descriptor.
 */
function remoteMethod(method, parameters, resultType) {
  return { method, parameters, result: strictCodec(resultType, jsonCodec()) }
}

/**
 * The client half of the remote contract for `failureLedger`.
 */
const CONTRIBUTION = {
  package: 'dsh-failure-ledger',
  descriptors: [
    remoteMethod('getLedger', [rpcParam('query', 'LedgerQuery', jsonCodec(), true), rpcParam('knownRevision', 'Revision', jsonCodec(), true)], 'LedgerResult'),
    remoteMethod('getGroup', [rpcParam('groupId', 'GroupId', jsonCodec()), rpcParam('limit', 'Limit', jsonCodec(), true)], 'GroupResult'),
    remoteMethod('refresh', [rpcParam('full', 'Flag', jsonCodec(), true)], 'ScanSummary'),
    remoteMethod('updatePrefs', [rpcParam('patch', 'PrefsPatch', jsonCodec())], 'UpdatePrefsResult'),
  ],
}

/**
 * Mount the remote contribution and take ownership of its release.
 * @param ctx - Client context.
 * @returns The service, or undefined when this host cannot mount remotes.
 */
async function mountRemote(ctx) {
  const remote = ctx.remote
  if (remote === undefined || typeof remote.$mount !== 'function') return undefined
  const unmount = await remote.$mount(CONTRIBUTION)
  ctx.effect(() => () => unmount(), 'failure-ledger: remote contribution')
  return ctx.get('remote.failureLedger')
}

/**
 * Read the ledger, polling while the panel is open.
 *
 * `knownRevision` short-circuits grouping on the host, so a poll that finds no
 * change costs one small request instead of a full regroup.
 * @param service - `failureLedger` service, or undefined before mounting.
 * @param query - Ledger query; changing it refetches.
 * @param options - `intervalMs` between polls; 0 disables polling.
 * @returns Ledger state plus a `reload()` that forces a refetch.
 */
function useLedger(service, query, options) {
  const intervalMs = options?.intervalMs ?? 5000
  const [state, setState] = React.useState({ ledger: undefined, error: undefined, loading: true })
  const [tick, setTick] = React.useState(0)
  const key = JSON.stringify(query ?? {})

  React.useEffect(() => {
    let cancelled = false
    let knownRevision = null
    if (service === undefined) {
      setState({ ledger: undefined, error: undefined, loading: false })
      return () => {
        cancelled = true
      }
    }
    async function load() {
      try {
        const ledger = await service.getLedger(JSON.parse(key), knownRevision)
        if (cancelled) return
        if (ledger !== undefined && ledger.unchanged === true) {
          setState((previous) => ({ ledger: previous.ledger, error: undefined, loading: false }))
          return
        }
        if (ledger !== undefined) knownRevision = ledger.revision
        setState({ ledger, error: undefined, loading: false })
      } catch (error) {
        if (!cancelled) setState({ ledger: undefined, error, loading: false })
      }
    }
    void load()
    const timer = intervalMs > 0 ? setInterval(() => { void load() }, intervalMs) : undefined
    return () => {
      cancelled = true
      if (timer !== undefined) clearInterval(timer)
    }
  }, [service, key, intervalMs, tick])

  function reload() {
    setTick((value) => value + 1)
  }

  return { ledger: state.ledger, error: state.error, loading: state.loading, reload }
}

/**
 * Translate a key, falling back to the key itself when the table has no entry.
 * @param translate - Locale lookup.
 * @param key - Dotted dictionary key.
 * @returns The translated string, or the key.
 */
function text(translate, key) {
  const value = typeof translate === 'function' ? translate(key) : undefined
  return typeof value === 'string' && value.length > 0 ? value : key
}
