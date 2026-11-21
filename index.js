import { normalizeConfig } from './lib/config.js'

/**
 * Cordis plugin name. DSH keys the profile's loader entries and the TYPERT
 * manifest on the package name, not on this value.
 */
export const name = 'failure-ledger'

/**
 * Host services this plugin reads. Both are optional to callers: the plugin
 * only answers RPC reads, and a profile without the session query service
 * fails loud at load instead of returning an empty ledger.
 */
export const inject = ['sessionQuery', 'sessionPersistence']

/**
 * Build the failure ledger's host side.
 *
 * This step validates configuration only. Session wiring, the ledger file and
 * the `failureLedger` service arrive with their own tasks.
 * @param ctx - Cordis plugin context.
 * @param rawConfig - `cordis.yml` config for this plugin.
 */
export async function apply(ctx, rawConfig) {
  normalizeConfig(rawConfig)
}
