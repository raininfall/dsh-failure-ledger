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
 * The empty ledger view: what the panel shows before the first scan lands.
 * @param props - `t` from the slot's injection.
 * @returns The page element.
 */
function Page(props) {
  const t = typeof props?.t === 'function' ? props.t : (key) => key
  return h(
    'section',
    { className: 'dsh-failure-ledger-page', 'aria-label': t('title') },
    h(
      'header',
      { className: 'dsh-failure-ledger-header' },
      h('h1', { className: 'dsh-failure-ledger-title' }, t('title')),
      h('p', { className: 'dsh-failure-ledger-caption' }, t('caption')),
    ),
    h(
      'div',
      { className: 'dsh-failure-ledger-empty' },
      h(PanelIcon, { size: 28 }),
      h('p', null, t('empty')),
    ),
  )
}
