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
  '.dsh-fl-sort{display:inline-flex;align-items:center;gap:4px;border:0;background:none;padding:0;margin:0;font:inherit;color:inherit;cursor:pointer}',
  '.dsh-fl-sort:hover{color:var(--dsw-alias-state-business-primary,#2b6cff)}',
  '.dsh-fl-sort:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#2b6cff);outline-offset:2px;border-radius:3px}',
  '.dsh-fl-arrow{font-size:10px;color:var(--dsw-alias-label-tertiary,#8b9099)}',
  '.dsh-fl-table td{padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,#eef0f3);vertical-align:top}',
  '.dsh-fl-row:hover td{background:var(--dsw-alias-interactive-bg-hover,#f2f4f7)}',
  '.dsh-fl-row-ignored td{opacity:.55}',
  '.dsh-fl-count{font-variant-numeric:tabular-nums;font-weight:600}',
  '.dsh-fl-signature{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;max-width:520px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-state-error-primary,#c0352b)}',
  '.dsh-fl-error{margin:0;font-size:12px;color:var(--dsw-alias-state-error-primary,#c0352b)}',
  '.dsh-fl-sorted{display:flex;flex-direction:column;gap:8px;flex:1 1 auto;min-width:0}',
  '.dsh-fl-sortbar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:12px}',
  '.dsh-fl-sortbar-label{color:var(--dsw-alias-label-tertiary,#8b9099)}',
  '.dsh-fl-sort-chip{cursor:default;color:var(--dsw-alias-state-business-primary,#2b6cff);border-color:var(--dsw-alias-state-business-primary,#2b6cff)}',
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

  let service
  try {
    service = await mountRemote(ctx)
  } catch (error) {
    // A rejected mount must not cost the user the panel: both slot entries
    // still register, and the page reports that it has no data.
    console.warn('[dsh-failure-ledger] remote contribution failed to mount', error)
  }

  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 50, label: () => translate('panel'), locale: NS }, PanelIcon),
  )

  ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => ({ t: translate, service }) }, Page),
  )
}
