/**
 * 删除守卫：判断某个版本能否安全删除，并给出具体原因供 UI 提示。
 *
 * 版本被迁移脚本（作为源或目标）或被环境关联时不允许删除，
 * 否则会让版本链断裂、迁移与环境指向不存在的版本。
 */
import type { Environment, Migration } from './types'

export type DeleteBlockReason =
  | {
      type: 'migration'
      id: string
      name: string
      /** 该版本在迁移中扮演的角色 */
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

/** 检查版本是否可删除 */
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
