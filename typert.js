import { allSchemas, schemaFor } from './lib/schemas.js'

/**
 * The host-side typert manifest, exported as `./typert`.
 *
 * DeepSeek Harness's typert loader imports this file at plugin load, checks
 * that the manifest names this package and the host face, and registers the
 * invocations so the client's `remote.$mount` can reach them.
 */

/**
 * One JSON-sourced parameter.
 * @param name - Wire field name; also the argument name.
 * @param type - Schema name from `lib/schemas.js`.
 * @param optional - Whether the caller may omit it (undefined is accepted).
 * @returns The parameter descriptor.
 */
function rpcParam(name, type, optional = false) {
  const codec = schemaFor(type)
  if (codec === undefined) throw new Error(`failure-ledger: no codec for ${type}`)
  return { name, wire: name, source: 'json', codec, ...(optional ? { acceptsUndefined: true } : {}) }
}

/**
 * One invokable service method.
 * @param method - Method name on the service.
 * @param parameters - Parameter descriptors.
 * @param result - Result schema name.
 * @param description - One-line summary for the generated docs view.
 * @returns The invocation descriptor.
 */
function invocation(method, parameters, result, description) {
  const codec = schemaFor(result)
  if (codec === undefined) throw new Error(`failure-ledger: no codec for ${result}`)
  return {
    id: `dsh-failure-ledger#failureLedger/${method}`,
    service: 'failureLedger',
    namespace: 'failureLedger',
    method,
    description,
    invocation: { kind: 'direct' },
    parameters,
    result: codec,
  }
}

/**
 * One documented service member.
 * @param name - Method name.
 * @param signature - TypeScript signature shown in the generated types.
 * @param summary - One-line summary.
 * @returns The member descriptor.
 */
function member(name, signature, summary) {
  return { kind: 'method', name, signature, summary }
}

export const TYPERT = {
  package: 'dsh-failure-ledger',
  face: 'host',
  schemas: allSchemas(),
  invocations: [
    invocation(
      'getLedger',
      [rpcParam('query', 'LedgerQuery', true), rpcParam('knownRevision', 'Revision', true)],
      'LedgerResult',
      'Read the grouped failure ledger',
    ),
    invocation(
      'getGroup',
      [rpcParam('groupId', 'GroupId'), rpcParam('limit', 'Limit', true)],
      'GroupResult',
      'Read one group and its newest occurrences',
    ),
    invocation('refresh', [rpcParam('full', 'Flag', true)], 'ScanSummary', 'Run one scan pass now'),
    invocation('updatePrefs', [rpcParam('patch', 'PrefsPatch')], 'UpdatePrefsResult', 'Change ignore and merge decisions'),
  ],
  model: {
    services: [
      {
        description: 'Deterministic failure ledger over recorded session logs',
        summary: 'Group tool and script failures from session logs without a model',
        tags: [],
        jsDoc: 'Groups recorded tool, job and sub-tool failures by tool, kind and normalized error signature.',
        key: 'failureLedger',
        exportName: 'createFailureLedgerService',
        members: [
          member('getLedger', 'getLedger(query: LedgerQuery | null, knownRevision: number | null): Promise<LedgerResult>', 'Read the grouped failure ledger'),
          member('getGroup', 'getGroup(groupId: string, limit: number): Promise<GroupResult>', 'Read one group and its newest occurrences'),
          member('refresh', 'refresh(full: boolean): Promise<ScanSummary>', 'Run one scan pass now'),
          member('updatePrefs', 'updatePrefs(patch: PrefsPatch): Promise<UpdatePrefsResult>', 'Change ignore and merge decisions'),
        ],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
}
