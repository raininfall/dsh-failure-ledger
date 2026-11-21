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
