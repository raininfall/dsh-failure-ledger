import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Concatenate the client fragments into the single module the harness loads.
 *
 * The browser side has no bundler: `lib/client.js` must be one file that
 * registers itself with `window.__ModuleLoader__`. Fragments are plain
 * declarations inside the factory, in filename order, and the locale
 * dictionaries are inlined so the bundle needs no file access at runtime.
 */

const ROOT = new URL('../', import.meta.url)
const FRAGMENTS = ['01-core.js', '02-page.js', '03-apply.js']
const OUTPUT = fileURLToPath(new URL('lib/client.js', ROOT))

const dictionaries = {
  zh: JSON.parse(readFileSync(new URL('locale/zh.json', ROOT), 'utf8')),
  en: JSON.parse(readFileSync(new URL('locale/en.json', ROOT), 'utf8')),
}

const body = FRAGMENTS.map((fragment) => readFileSync(new URL(`src/client/${fragment}`, ROOT), 'utf8')).join('\n')

const bundle = `window.__ModuleLoader__.load({ id: 'dsh-failure-ledger', factory: (require) => {
var module = { exports: {} }
var exports = module.exports
Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
const React = require('react')
const DICTIONARIES = ${JSON.stringify(dictionaries)}
${body}
exports.apply = apply
exports.inject = inject
return module.exports
} })
`

writeFileSync(OUTPUT, bundle)
process.stdout.write(`wrote ${OUTPUT} (${bundle.length} bytes)\n`)
