/**
 * Delete guards: determine whether a version can be safely deleted and provide specific reasons for UI prompts.
 *
 * A version cannot be deleted while it is used by a migration (as source or target) or linked to
 * an environment, otherwise the version chain breaks and migrations/environments point to a nonexistent version.
 */
import type { Environment, Migration } from './types'

export type DeleteBlockReason =
  | {
      type: 'migration'
      id: string
      name: string
      /** Role this version plays in the migration */
      role: 'from' | 'to'
    }
  | {
      type: 'environment'
      id: string
      name: string
    }

export interface DeleteCheckResult {
  ok: boolean
  reasons: DeleteBlockReason[]
}

/** Check whether a version can be deleted */
export function canDeleteVersion(
  versionId: string,
  migrations: Migration[],
  environments: Environment[],
): DeleteCheckResult {
  const reasons: DeleteBlockReason[] = []

  for (const m of migrations) {
    if (m.from_version === versionId) {
      reasons.push({ type: 'migration', id: m.id, name: m.name, role: 'from' })
    }
    if (m.to_version === versionId) {
      reasons.push({ type: 'migration', id: m.id, name: m.name, role: 'to' })
    }
  }

  for (const env of environments) {
    if (env.version_id === versionId) {
      reasons.push({ type: 'environment', id: env.id, name: env.name })
    }
  }

  return { ok: reasons.length === 0, reasons }
}
