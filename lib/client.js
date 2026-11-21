window.__ModuleLoader__.load({ id: 'dsh-failure-ledger', factory: (require) => {
var module = { exports: {} }
var exports = module.exports
Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
const React = require('react')
const DICTIONARIES = {"zh":{"panel":"失败台账","title":"工具失败台账","caption":"来自会话日志的工具与脚本调用失败，按确定性规则分组","empty":"还没有扫描结果","refresh":"重新扫描","scanning":"正在扫描…","time.now":"刚刚","time.minutes":"{n} 分钟前","time.hours":"{n} 小时前","time.days":"{n} 天前","kind.error":"工具报错","kind.exit":"非零退出","kind.signal":"被信号终止","kind.timeout":"超时","kind.job-failed":"后台作业失败","kind.job-killed":"后台作业被终止","kind.ptc-error":"子工具报错"},"en":{"panel":"Failure ledger","title":"Tool failure ledger","caption":"Tool and script failures from session logs, grouped by deterministic rules","empty":"No scan results yet","refresh":"Rescan","scanning":"Scanning…","time.now":"just now","time.minutes":"{n} min ago","time.hours":"{n} h ago","time.days":"{n} d ago","kind.error":"tool error","kind.exit":"non-zero exit","kind.signal":"killed by signal","kind.timeout":"timed out","kind.job-failed":"job failed","kind.job-killed":"job killed","kind.ptc-error":"sub-tool error"}}
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

/**
 * Registration half of the client bundle: styles, locale and slots.
 */

/** Where the injected stylesheet is tagged in `document.head`. */
const STYLE_TAG = 'dsh-failure-ledger/client.css'

/**
 * Panel styles. Theme tokens carry fallbacks so an older theme that lacks one
 * still renders a usable page instead of dropping the declaration.
 */
const CSS = [
  '.dsh-failure-ledger-page{display:flex;flex-direction:column;gap:16px;padding:20px 24px;height:100%;box-sizing:border-box;overflow:auto;color:var(--dsw-alias-label-primary,#1f2329)}',
  '.dsh-failure-ledger-header{display:flex;flex-direction:column;gap:4px}',
  '.dsh-failure-ledger-title{margin:0;font-size:16px;font-weight:600;line-height:22px}',
  '.dsh-failure-ledger-caption{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8b9099)}',
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
 * Services the panel needs.
 */
const inject = ['slots', 'locale', 'layout']

/**
 * Register the sidebar entry and the keyed main panel.
 * @param ctx - Client context.
 */
function apply(ctx) {
  const disposeLocale = installLocale(ctx)
  installStyles()
  let translate = localT
  try {
    if (ctx.locale !== undefined && typeof ctx.locale.bind === 'function') translate = ctx.locale.bind(NS)
  } catch {
    // Fall back to the bundled dictionaries rather than failing registration.
  }
  ctx.effect(() => () => disposeLocale(), 'failure-ledger: locale dictionaries')

  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 50, label: () => translate('panel'), locale: NS }, PanelIcon),
  )

  ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => ({ t: translate }) }, Page),
  )
}

exports.apply = apply
exports.inject = inject
return module.exports
} })
