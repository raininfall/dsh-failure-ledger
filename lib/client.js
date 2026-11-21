window.__ModuleLoader__.load({ id: 'dsh-failure-ledger', factory: (require) => {
var module = { exports: {} }
var exports = module.exports
Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
const React = require('react')
const DICTIONARIES = {"zh":{"panel":"失败台账","title":"工具失败台账","caption":"来自会话日志的工具与脚本调用失败，按确定性规则分组","empty":"还没有扫描结果","refresh":"重新扫描","scanning":"正在扫描…","time.never":"从未","time.now":"刚刚","time.minutes":"{n} 分钟前","time.hours":"{n} 小时前","time.days":"{n} 天前","totals.failures":"失败次数","totals.groups":"分组数","totals.sessions":"会话数","totals.scanErrors":"扫描错误","totals.unknownOutcome":"结果未知","totals.lastScanAt":"上次扫描","filter.tool":"按工具筛选","filter.kind":"按类型筛选","filter.text":"搜索错误文本","filter.jobKilled":"含被终止的后台作业","filter.hideIgnored":"隐藏已忽略","filter.sort":"排序","sort.count":"按次数","sort.last":"按最近","column.count":"次数","column.tool":"工具","column.kind":"类型","column.signature":"错误签名","column.lastAt":"最后出现","column.sessions":"会话","kind.error":"工具报错","kind.exit":"非零退出","kind.signal":"被信号终止","kind.timeout":"超时","kind.job-failed":"后台作业失败","kind.job-killed":"后台作业被终止","kind.ptc-error":"子工具报错","notice.merge-target-missing":"合并目标已不存在，该合并被跳过","notice.ledger-recovered":"台账文件损坏，已重建并备份原文件","action.select":"选择","action.mute":"忽略该组","action.unmute":"取消忽略","action.copySession":"复制会话 ID","action.close":"关闭","action.merge":"合并","action.mergeInto":"合并到…","action.clearSelection":"清除选择","action.working":"处理中…","detail.title":"分组明细","detail.loading":"正在加载明细…","detail.empty":"该组没有可显示的记录","detail.untitled":"未命名会话","merge.selected":"已选 {n} 组","error.action":"操作失败"},"en":{"panel":"Failure ledger","title":"Tool failure ledger","caption":"Tool and script failures from session logs, grouped by deterministic rules","empty":"No scan results yet","refresh":"Rescan","scanning":"Scanning…","time.never":"never","time.now":"just now","time.minutes":"{n} min ago","time.hours":"{n} h ago","time.days":"{n} d ago","totals.failures":"failures","totals.groups":"groups","totals.sessions":"sessions","totals.scanErrors":"scan errors","totals.unknownOutcome":"unknown outcome","totals.lastScanAt":"last scan","filter.tool":"Filter by tool","filter.kind":"Filter by kind","filter.text":"Search error text","filter.jobKilled":"Include killed jobs","filter.hideIgnored":"Hide ignored","filter.sort":"Sort","sort.count":"By count","sort.last":"By most recent","column.count":"Count","column.tool":"Tool","column.kind":"Kind","column.signature":"Error signature","column.lastAt":"Last seen","column.sessions":"Sessions","kind.error":"tool error","kind.exit":"non-zero exit","kind.signal":"killed by signal","kind.timeout":"timed out","kind.job-failed":"job failed","kind.job-killed":"job killed","kind.ptc-error":"sub-tool error","notice.merge-target-missing":"A merge target no longer exists; the merge was skipped","notice.ledger-recovered":"The ledger file was unreadable; it was rebuilt and the original backed up","action.select":"Select","action.mute":"Mute group","action.unmute":"Unmute group","action.copySession":"Copy session id","action.close":"Close","action.merge":"Merge","action.mergeInto":"Merge into…","action.clearSelection":"Clear selection","action.working":"Working…","detail.title":"Group detail","detail.loading":"Loading occurrences…","detail.empty":"This group has no visible occurrences","detail.untitled":"Untitled session","merge.selected":"{n} selected","error.action":"Action failed"}}
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

/**
 * Page components for the failure ledger.
 *
 * Built with `React.createElement` rather than JSX: the client bundle is a
 * concatenation of these fragments, with no transform step in between.
 */

const h = React.createElement

/**
 * Sidebar glyph: a warning triangle drawn inline, so the entry does not depend
 * on which icon names the installed primitives package happens to export.
 * @param props - `size` in pixels and whether the entry is active.
 * @returns The icon element.
 */
function PanelIcon(props) {
  const size = typeof props?.size === 'number' ? props.size : 16
  return h(
    'svg',
    { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
    h('path', {
      d: 'M8 2.2 14.4 13.2H1.6L8 2.2Z',
      stroke: 'currentColor',
      strokeWidth: '1.2',
      strokeLinejoin: 'round',
    }),
    h('path', { d: 'M8 6.1v3.2', stroke: 'currentColor', strokeWidth: '1.2', strokeLinecap: 'round' }),
    h('circle', { cx: '8', cy: '11.3', r: '0.75', fill: 'currentColor' }),
  )
}

/**
 * Build the query the host understands from the panel's filter state.
 * @param filters - Filter state.
 * @returns A query object without empty fields.
 */
function queryOf(filters) {
  const query = { hideIgnored: filters.hideIgnored, sort: filters.sort }
  if (filters.tool.length > 0) query.tool = filters.tool
  if (filters.text.length > 0) query.text = filters.text
  if (filters.kinds.length > 0) query.kinds = filters.kinds
  if (filters.includeJobKilled) query.includeJobKilled = true
  return query
}

/**
 * One labelled total.
 * @param props - `label` and `value`.
 * @returns The total element.
 */
function Total(props) {
  return h('div', { className: 'dsh-fl-total' }, h('dt', null, props.label), h('dd', null, props.value))
}

/**
 * The totals strip.
 * @param props - `t` and the ledger totals.
 * @returns The totals element.
 */
function Totals(props) {
  const t = props.t
  const totals = props.totals ?? {}
  return h(
    'dl',
    { className: 'dsh-fl-totals' },
    h(Total, { label: t('totals.failures'), value: formatCount(totals.failures) }),
    h(Total, { label: t('totals.groups'), value: formatCount(totals.groups) }),
    h(Total, { label: t('totals.sessions'), value: formatCount(totals.sessions) }),
    h(Total, { label: t('totals.scanErrors'), value: formatCount(totals.scanErrors) }),
    h(Total, { label: t('totals.unknownOutcome'), value: formatCount(totals.unknownOutcome) }),
    h(Total, {
      label: t('totals.lastScanAt'),
      value: totals.lastScanAt > 0 ? formatRelativeTime(totals.lastScanAt, t) : t('time.never'),
    }),
  )
}

/**
 * Notices the host raised while building this result.
 * @param props - `t` and the notice list.
 * @returns The notice strip, or null when there is nothing to report.
 */
function Notices(props) {
  if (!Array.isArray(props.notices) || props.notices.length === 0) return null
  return h(
    'ul',
    { className: 'dsh-fl-notices' },
    props.notices.map((notice, index) =>
      h(
        'li',
        { key: String(index) },
        h('span', { className: 'dsh-fl-notice-code' }, props.t('notice.' + notice.code)),
        notice.from === undefined ? null : h('code', null, String(notice.from)),
      ),
    ),
  )
}

/**
 * Tool, text and kind filters plus the visibility toggles.
 * @param props - `t`, filter state and its setter.
 * @returns The filter bar.
 */
function Filters(props) {
  const t = props.t
  const filters = props.filters
  const patch = props.onChange
  const kinds = props.kinds ?? KINDS
  function toggleKind(kind) {
    const next = filters.kinds.includes(kind) ? filters.kinds.filter((value) => value !== kind) : [...filters.kinds, kind]
    patch({ ...filters, kinds: next })
  }
  return h(
    'div',
    { className: 'dsh-fl-filters' },
    h('input', {
      className: 'dsh-fl-input',
      type: 'search',
      value: filters.tool,
      placeholder: t('filter.tool'),
      'aria-label': t('filter.tool'),
      onChange: (event) => patch({ ...filters, tool: event.target.value }),
    }),
    h('input', {
      className: 'dsh-fl-input',
      type: 'search',
      value: filters.text,
      placeholder: t('filter.text'),
      'aria-label': t('filter.text'),
      onChange: (event) => patch({ ...filters, text: event.target.value }),
    }),
    h(
      'div',
      { className: 'dsh-fl-kinds', role: 'group', 'aria-label': t('filter.kind') },
      kinds.map((kind) =>
        h(
          'label',
          { key: kind, className: filters.kinds.includes(kind) ? 'dsh-fl-chip dsh-fl-chip-on' : 'dsh-fl-chip' },
          h('input', { type: 'checkbox', checked: filters.kinds.includes(kind), onChange: () => toggleKind(kind) }),
          kindLabel(kind, t),
        ),
      ),
    ),
    h(
      'label',
      { className: 'dsh-fl-check' },
      h('input', {
        type: 'checkbox',
        checked: filters.includeJobKilled,
        onChange: (event) => patch({ ...filters, includeJobKilled: event.target.checked }),
      }),
      t('filter.jobKilled'),
    ),
    h(
      'label',
      { className: 'dsh-fl-check' },
      h('input', {
        type: 'checkbox',
        checked: filters.hideIgnored,
        onChange: (event) => patch({ ...filters, hideIgnored: event.target.checked }),
      }),
      t('filter.hideIgnored'),
    ),
    h(
      'select',
      {
        className: 'dsh-fl-select',
        value: filters.sort,
        'aria-label': t('filter.sort'),
        onChange: (event) => patch({ ...filters, sort: event.target.value }),
      },
      h('option', { value: 'count' }, t('sort.count')),
      h('option', { value: 'last' }, t('sort.last')),
    ),
  )
}

/**
 * The grouped failure table, with selection and per-row mute.
 * @param props - `t`, rows, selection state and the row callbacks.
 * @returns The table element.
 */
function GroupTable(props) {
  const t = props.t
  const selected = props.selected
  return h(
    'table',
    { className: 'dsh-fl-table' },
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        h('th', { scope: 'col', className: 'dsh-fl-select-cell' }, ''),
        h('th', { scope: 'col' }, t('column.count')),
        h('th', { scope: 'col' }, t('column.tool')),
        h('th', { scope: 'col' }, t('column.kind')),
        h('th', { scope: 'col' }, t('column.signature')),
        h('th', { scope: 'col' }, t('column.lastAt')),
        h('th', { scope: 'col' }, t('column.sessions')),
        h('th', { scope: 'col', className: 'dsh-fl-select-cell' }, ''),
      ),
    ),
    h(
      'tbody',
      null,
      props.groups.map((group) =>
        h(
          'tr',
          {
            key: group.groupId,
            className: [
              'dsh-fl-row',
              group.ignored ? 'dsh-fl-row-ignored' : '',
              props.activeId === group.groupId ? 'dsh-fl-row-active' : '',
            ]
              .filter((name) => name.length > 0)
              .join(' '),
          },
          h(
            'td',
            { className: 'dsh-fl-select-cell' },
            h('input', {
              type: 'checkbox',
              'aria-label': t('action.select'),
              checked: selected.includes(group.groupId),
              onChange: () => props.onToggle(group.groupId),
              onClick: (event) => event.stopPropagation(),
            }),
          ),
          h('td', { className: 'dsh-fl-count' }, formatCount(group.count)),
          h('td', null, group.tool),
          h('td', null, kindLabel(group.kind, t)),
          h(
            'td',
            { className: 'dsh-fl-signature', title: group.signature, onClick: () => props.onOpen(group.groupId) },
            group.signature,
          ),
          h('td', null, formatRelativeTime(group.lastAt, t)),
          h('td', null, formatCount(group.sessionCount)),
          h(
            'td',
            { className: 'dsh-fl-select-cell' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-fl-link',
                onClick: (event) => {
                  event.stopPropagation()
                  props.onMute(group.groupId, group.ignored !== true)
                },
              },
              group.ignored ? t('action.unmute') : t('action.mute'),
            ),
          ),
        ),
      ),
    ),
  )
}

/**
 * One group's occurrences, newest first.
 * @param props - `t`, the loaded group and its state.
 * @returns The detail element.
 */
function GroupDetail(props) {
  const t = props.t
  const group = props.group
  const rows = group === undefined ? [] : group.occurrences
  return h(
    'aside',
    { className: 'dsh-fl-detail', 'aria-label': t('detail.title') },
    h(
      'header',
      { className: 'dsh-fl-detail-header' },
      h('h2', { className: 'dsh-fl-detail-title' }, group === undefined ? t('detail.loading') : kindLabel(group.kind, t) + ' · ' + group.tool),
      h('button', { type: 'button', className: 'dsh-fl-link', onClick: props.onClose }, t('action.close')),
    ),
    group === undefined
      ? h('p', { className: 'dsh-fl-muted' }, t('detail.loading'))
      : h(
          'div',
          { className: 'dsh-fl-detail-body' },
          h('p', { className: 'dsh-fl-signature dsh-fl-signature-block' }, group.signature),
          rows.length === 0
            ? h('p', { className: 'dsh-fl-muted' }, t('detail.empty'))
            : h(
                'ul',
                { className: 'dsh-fl-occurrences' },
                rows.map((occurrence, index) =>
                  h(
                    'li',
                    { key: String(index), className: 'dsh-fl-occurrence' },
                    h(
                      'div',
                      { className: 'dsh-fl-occurrence-meta' },
                      h('span', null, formatRelativeTime(occurrence.at, t)),
                      h('span', { className: 'dsh-fl-muted' }, occurrence.sessionTitle.length > 0 ? occurrence.sessionTitle : t('detail.untitled')),
                      h('button', {
                        type: 'button',
                        className: 'dsh-fl-link',
                        onClick: () => props.onCopySession(occurrence.sessionId),
                      }, t('action.copySession')),
                    ),
                    h('code', { className: 'dsh-fl-occurrence-line' }, occurrence.line),
                    h('span', { className: 'dsh-fl-muted' }, occurrence.cwd),
                  ),
                ),
              ),
        ),
  )
}

/**
 * The merge control for the current selection.
 * @param props - `t`, candidate targets, selection and callbacks.
 * @returns The merge bar, or null when nothing is selected.
 */
function MergeBar(props) {
  if (props.selected.length === 0) return null
  const t = props.t
  return h(
    'div',
    { className: 'dsh-fl-merge' },
    h('span', null, t('merge.selected').replace('{n}', String(props.selected.length))),
    h(
      'select',
      {
        className: 'dsh-fl-select',
        value: props.target,
        'aria-label': t('action.mergeInto'),
        onChange: (event) => props.onTarget(event.target.value),
      },
      h('option', { value: '' }, t('action.mergeInto')),
      props.candidates.map((candidate) => h('option', { key: candidate.groupId, value: candidate.groupId }, candidate.signature)),
    ),
    h('button', {
      type: 'button',
      className: 'dsh-fl-button',
      disabled: props.target.length === 0,
      onClick: () => props.onMerge(props.target),
    }, t('action.merge')),
    h('button', { type: 'button', className: 'dsh-fl-link', onClick: props.onClear }, t('action.clearSelection')),
  )
}

/**
 * The ledger panel.
 * @param props - `t` and the mounted `service`, both injected by the slot.
 * @returns The page element.
 */
function Page(props) {
  const t = typeof props?.t === 'function' ? props.t : (key) => key
  const service = props?.service
  const [filters, setFilters] = React.useState({ tool: '', text: '', kinds: [], includeJobKilled: false, hideIgnored: true, sort: 'count' })
  const [selected, setSelected] = React.useState([])
  const [target, setTarget] = React.useState('')
  const [activeId, setActiveId] = React.useState(undefined)
  const [detail, setDetail] = React.useState(undefined)
  const [busy, setBusy] = React.useState(false)
  const [actionError, setActionError] = React.useState(undefined)
  const state = useLedger(service, queryOf(filters))
  const ledger = state.ledger
  const groups = ledger === undefined ? [] : ledger.groups
  const totals = ledger === undefined ? undefined : ledger.totals

  React.useEffect(() => {
    let cancelled = false
    if (activeId === undefined || service === undefined) {
      setDetail(undefined)
      return () => {
        cancelled = true
      }
    }
    service
      .getGroup(activeId, 20)
      .then((value) => {
        if (!cancelled) setDetail(value)
      })
      .catch((error) => {
        if (!cancelled) setActionError(error)
      })
    return () => {
      cancelled = true
    }
  }, [activeId, service, state.ledger])

  /**
   * Run one preference change, then refetch the ledger.
   * @param patch - `updatePrefs` patch.
   */
  async function changePreferences(patch) {
    if (service === undefined) return
    setBusy(true)
    setActionError(undefined)
    try {
      await service.updatePrefs(patch)
      state.reload()
    } catch (error) {
      setActionError(error)
    } finally {
      setBusy(false)
    }
  }

  function toggleSelected(groupId) {
    setSelected((current) => (current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId]))
  }

  async function rescan() {
    setBusy(true)
    setActionError(undefined)
    try {
      if (service !== undefined) await service.refresh(true)
    } finally {
      setBusy(false)
      state.reload()
    }
  }

  async function copySession(sessionId) {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) await navigator.clipboard.writeText(sessionId)
    } catch (error) {
      setActionError(error)
    }
  }

  const selectedGroups = groups.filter((group) => selected.includes(group.groupId))
  const selectedKinds = selectedGroups.map((group) => group.tool + '\u0000' + group.kind)
  const candidates = groups.filter(
    (group) => !selected.includes(group.groupId) && (selectedGroups.length === 0 || selectedKinds.includes(group.tool + '\u0000' + group.kind)),
  )

  return h(
    'section',
    { className: 'dsh-failure-ledger-page', 'aria-label': t('title') },
    h(
      'header',
      { className: 'dsh-failure-ledger-header' },
      h('h1', { className: 'dsh-failure-ledger-title' }, t('title')),
      h('p', { className: 'dsh-failure-ledger-caption' }, t('caption')),
      h(
        'div',
        { className: 'dsh-fl-actions' },
        ledger !== undefined && ledger.scanning === true ? h('span', { className: 'dsh-fl-scanning' }, t('scanning')) : null,
        busy ? h('span', { className: 'dsh-fl-scanning' }, t('action.working')) : null,
        h('button', { type: 'button', className: 'dsh-fl-button', disabled: busy, onClick: rescan }, t('refresh')),
      ),
    ),
    h(Totals, { t, totals }),
    h(Notices, { t, notices: ledger === undefined ? [] : ledger.notices }),
    h(Filters, { t, filters, onChange: setFilters }),
    h(MergeBar, {
      t,
      selected,
      target,
      candidates,
      onTarget: setTarget,
      onMerge: (to) => changePreferences({ merge: selected.map((from) => ({ from, to })) }),
      onClear: () => {
        setSelected([])
        setTarget('')
      },
    }),
    state.error !== undefined
      ? h('p', { className: 'dsh-fl-error', role: 'alert' }, String(state.error.message ?? state.error))
      : groups.length === 0
        ? h('div', { className: 'dsh-failure-ledger-empty' }, h(PanelIcon, { size: 28 }), h('p', null, t(state.loading ? 'scanning' : 'empty')))
        : h(
            'div',
            { className: 'dsh-fl-body' },
            h('div', { className: 'dsh-fl-table-wrap' }, h(GroupTable, {
              t,
              groups,
              selected,
              activeId,
              onToggle: toggleSelected,
              onOpen: setActiveId,
              onMute: (groupId, mute) => changePreferences(mute ? { ignore: [groupId] } : { unignore: [groupId] }),
            })),
            activeId === undefined ? null : h(GroupDetail, {
              t,
              group: detail,
              onClose: () => {
                setActiveId(undefined)
                setDetail(undefined)
              },
              onCopySession: copySession,
            }),
          ),
    actionError === undefined
      ? null
      : h('p', { className: 'dsh-fl-error', role: 'alert' }, t('error.action') + ': ' + String(actionError.message ?? actionError)),
  )
}

/**
 * Registration half of the client bundle: styles, locale, slots and the
 * remote contribution.
 */

/** Where the injected stylesheet is tagged in `document.head`. */
const STYLE_TAG = 'dsh-failure-ledger/client.css'

/**
 * Panel styles. Theme tokens carry fallbacks so an older theme that lacks one
 * still renders a usable page instead of dropping the declaration.
 */
const CSS = [
  '.dsh-failure-ledger-page{display:flex;flex-direction:column;gap:14px;padding:20px 24px;height:100%;box-sizing:border-box;overflow:auto;color:var(--dsw-alias-label-primary,#1f2329)}',
  '.dsh-failure-ledger-header{display:flex;flex-direction:column;gap:4px}',
  '.dsh-failure-ledger-title{margin:0;font-size:16px;font-weight:600;line-height:22px}',
  '.dsh-failure-ledger-caption{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8b9099)}',
  '.dsh-fl-actions{display:flex;align-items:center;gap:8px;margin-top:6px}',
  '.dsh-fl-button{border:1px solid var(--dsw-alias-border-l1,#dde0e6);background:var(--dsw-alias-bg-layer-1,#fafbfc);color:inherit;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer}',
  '.dsh-fl-button:hover{background:var(--dsw-alias-interactive-bg-hover,#eef0f3)}',
  '.dsh-fl-scanning{font-size:12px;color:var(--dsw-alias-state-business-primary,#2b6cff)}',
  '.dsh-fl-totals{display:flex;flex-wrap:wrap;gap:8px;margin:0}',
  '.dsh-fl-total{display:flex;flex-direction:column;gap:2px;min-width:88px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1,#dde0e6);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fafbfc)}',
  '.dsh-fl-total dt{margin:0;font-size:11px;color:var(--dsw-alias-label-tertiary,#8b9099)}',
  '.dsh-fl-total dd{margin:0;font-size:16px;font-weight:600}',
  '.dsh-fl-notices{list-style:none;margin:0;padding:8px 10px;display:flex;flex-direction:column;gap:4px;border:1px solid var(--dsw-alias-state-warn-primary,#d89614);border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f5f6f8);font-size:12px}',
  '.dsh-fl-notices code{margin-left:6px;color:var(--dsw-alias-label-secondary,#5f6570)}',
  '.dsh-fl-filters{display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
  '.dsh-fl-input,.dsh-fl-select{border:1px solid var(--dsw-alias-border-l1,#dde0e6);background:var(--dsw-alias-bg-base,#fff);color:inherit;border-radius:6px;padding:4px 8px;font-size:12px;min-width:140px}',
  '.dsh-fl-kinds{display:flex;flex-wrap:wrap;gap:4px}',
  '.dsh-fl-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l1,#dde0e6);border-radius:999px;padding:2px 8px;font-size:11px;color:var(--dsw-alias-label-secondary,#5f6570);cursor:pointer}',
  '.dsh-fl-chip-on{border-color:var(--dsw-alias-state-business-primary,#2b6cff);color:var(--dsw-alias-state-business-primary,#2b6cff);background:var(--dsw-alias-bg-layer-2,#f5f6f8)}',
  '.dsh-fl-chip input{display:none}',
  '.dsh-fl-check{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary,#5f6570)}',
  '.dsh-fl-table-wrap{overflow:auto;border:1px solid var(--dsw-alias-border-l1,#dde0e6);border-radius:8px}',
  '.dsh-fl-table{width:100%;border-collapse:collapse;font-size:12px}',
  '.dsh-fl-table th{position:sticky;top:0;text-align:left;font-weight:600;padding:8px 10px;background:var(--dsw-alias-bg-layer-2,#f5f6f8);border-bottom:1px solid var(--dsw-alias-border-l1,#dde0e6);white-space:nowrap}',
  '.dsh-fl-table td{padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,#eef0f3);vertical-align:top}',
  '.dsh-fl-row:hover td{background:var(--dsw-alias-interactive-bg-hover,#f2f4f7)}',
  '.dsh-fl-row-ignored td{opacity:.55}',
  '.dsh-fl-count{font-variant-numeric:tabular-nums;font-weight:600}',
  '.dsh-fl-signature{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;max-width:520px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-state-error-primary,#c0352b)}',
  '.dsh-fl-error{margin:0;font-size:12px;color:var(--dsw-alias-state-error-primary,#c0352b)}',
  '.dsh-fl-body{display:flex;align-items:flex-start;gap:12px;min-height:0}',
  '.dsh-fl-body>.dsh-fl-table-wrap{flex:1 1 auto;min-width:0}',
  '.dsh-fl-select-cell{width:34px;text-align:center}',
  '.dsh-fl-table .dsh-fl-signature{cursor:pointer}',
  '.dsh-fl-row-active td{background:var(--dsw-alias-bg-layer-2,#f5f6f8)}',
  '.dsh-fl-link{border:0;background:none;padding:0;font-size:12px;color:var(--dsw-alias-state-business-primary,#2b6cff);cursor:pointer}',
  '.dsh-fl-link:hover{text-decoration:underline}',
  '.dsh-fl-detail{flex:0 0 320px;max-width:40%;max-height:62vh;overflow:auto;display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--dsw-alias-border-l1,#dde0e6);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fafbfc)}',
  '.dsh-fl-detail-header{display:flex;align-items:center;justify-content:space-between;gap:8px}',
  '.dsh-fl-detail-title{margin:0;font-size:13px;font-weight:600}',
  '.dsh-fl-detail-body{display:flex;flex-direction:column;gap:10px}',
  '.dsh-fl-muted{margin:0;font-size:11px;color:var(--dsw-alias-label-tertiary,#8b9099)}',
  '.dsh-fl-signature-block{max-width:none;white-space:normal;overflow:visible;word-break:break-all;font-size:11px}',
  '.dsh-fl-occurrences{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}',
  '.dsh-fl-occurrence{display:flex;flex-direction:column;gap:3px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1,#eef0f3)}',
  '.dsh-fl-occurrence-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:11px}',
  '.dsh-fl-occurrence-line{white-space:pre-wrap;word-break:break-all;font-size:11px}',
  '.dsh-fl-merge{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-state-business-primary,#2b6cff);border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f5f6f8);font-size:12px}',
  '.dsh-failure-ledger-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;flex:1;min-height:180px;border:1px dashed var(--dsw-alias-border-l1,#dde0e6);border-radius:10px;color:var(--dsw-alias-label-secondary,#5f6570);background:var(--dsw-alias-bg-layer-1,#fafbfc)}',
  '.dsh-failure-ledger-empty p{margin:0;font-size:13px}',
  '.dsh-failure-ledger-empty svg{color:var(--dsw-alias-label-tertiary,#8b9099)}',
].join('')

/**
 * Write the stylesheet once, replacing it when the text changes so a rebuilt
 * bundle does not leave a stale copy behind.
 * @returns Nothing.
 */
function installStyles() {
  if (typeof document === 'undefined' || document.head === null) return
  const selector = 'style[data-plugin-css="' + STYLE_TAG + '"]'
  const existing = document.head.querySelector(selector)
  if (existing !== null && existing.textContent === CSS) return
  const style = existing ?? document.createElement('style')
  style.setAttribute('data-plugin-css', STYLE_TAG)
  style.textContent = CSS
  if (existing === null) document.head.appendChild(style)
}

/**
 * Translate through the bundled dictionaries when the harness locale service
 * is unavailable.
 * @param key - Dotted dictionary key.
 * @returns The translated string, or the key itself.
 */
function localT(key) {
  const languages = typeof navigator === 'undefined' ? [] : [navigator.language ?? '']
  const language = (Array.isArray(languages) ? languages[0] : '').toLowerCase()
  const table = language.startsWith('zh') ? DICTIONARIES.zh : DICTIONARIES.en
  const value = table[key] ?? DICTIONARIES.en[key]
  return typeof value === 'string' ? value : key
}

/**
 * Register this plugin's dictionaries with the harness locale service.
 * @param ctx - Client context.
 * @returns A disposer, possibly a no-op.
 */
function installLocale(ctx) {
  try {
    if (ctx.locale !== undefined && typeof ctx.locale.register === 'function') return ctx.locale.register(NS, DICTIONARIES)
  } catch {
    // A harness without a registerable locale service still renders: `localT`
    // covers the copy, and the panel stays readable.
  }
  return () => {}
}

/**
 * Services the panel needs. `remote` is required for data; without it the
 * panel still registers and explains that it has nothing to show.
 */
const inject = ['slots', 'locale', 'layout', 'remote']

/**
 * Register the sidebar entry and the keyed main panel.
 * @param ctx - Client context.
 */
async function apply(ctx) {
  const disposeLocale = installLocale(ctx)
  installStyles()
  let translate = localT
  try {
    if (ctx.locale !== undefined && typeof ctx.locale.bind === 'function') translate = ctx.locale.bind(NS)
  } catch {
    // Fall back to the bundled dictionaries rather than failing registration.
  }
  ctx.effect(() => () => disposeLocale(), 'failure-ledger: locale dictionaries')

  const service = await mountRemote(ctx)

  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 50, label: () => translate('panel'), locale: NS }, PanelIcon),
  )

  ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => ({ t: translate, service }) }, Page),
  )
}

exports.apply = apply
exports.inject = inject
return module.exports
} })
