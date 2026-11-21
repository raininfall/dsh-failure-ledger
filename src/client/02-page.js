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
