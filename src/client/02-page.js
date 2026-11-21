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
 * The grouped failure table.
 * @param props - `t` and the group rows.
 * @returns The table element.
 */
function GroupTable(props) {
  const t = props.t
  return h(
    'table',
    { className: 'dsh-fl-table' },
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        h('th', { scope: 'col' }, t('column.count')),
        h('th', { scope: 'col' }, t('column.tool')),
        h('th', { scope: 'col' }, t('column.kind')),
        h('th', { scope: 'col' }, t('column.signature')),
        h('th', { scope: 'col' }, t('column.lastAt')),
        h('th', { scope: 'col' }, t('column.sessions')),
      ),
    ),
    h(
      'tbody',
      null,
      props.groups.map((group) =>
        h(
          'tr',
          { key: group.groupId, className: group.ignored ? 'dsh-fl-row dsh-fl-row-ignored' : 'dsh-fl-row' },
          h('td', { className: 'dsh-fl-count' }, formatCount(group.count)),
          h('td', null, group.tool),
          h('td', null, kindLabel(group.kind, t)),
          h('td', { className: 'dsh-fl-signature', title: group.signature }, group.signature),
          h('td', null, formatRelativeTime(group.lastAt, t)),
          h('td', null, formatCount(group.sessionCount)),
        ),
      ),
    ),
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
  const state = useLedger(service, queryOf(filters))
  const ledger = state.ledger
  const groups = ledger === undefined ? [] : ledger.groups
  const totals = ledger === undefined ? undefined : ledger.totals

  async function onRefresh() {
    try {
      if (service !== undefined) await service.refresh(false)
    } finally {
      state.reload()
    }
  }

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
        h('button', { type: 'button', className: 'dsh-fl-button', onClick: onRefresh }, t('refresh')),
      ),
    ),
    h(Totals, { t, totals }),
    h(Notices, { t, notices: ledger === undefined ? [] : ledger.notices }),
    h(Filters, { t, filters, onChange: setFilters }),
    state.error !== undefined
      ? h('p', { className: 'dsh-fl-error', role: 'alert' }, String(state.error.message ?? state.error))
      : groups.length === 0
        ? h('div', { className: 'dsh-failure-ledger-empty' }, h(PanelIcon, { size: 28 }), h('p', null, t(state.loading ? 'scanning' : 'empty')))
        : h('div', { className: 'dsh-fl-table-wrap' }, h(GroupTable, { t, groups })),
  )
}
