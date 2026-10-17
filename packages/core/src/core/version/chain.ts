/**
 * 版本链：把离散的版本按父子关系串成线性时间轴，并标注相邻版本之间缺失的迁移。
 *
 * 版本在快照上记录 parent_id，链即由此推导；早期版本没有 parent_id，
 * 退化为按 created_at 排序，行为与旧版一致。
 * 分叉（同一父版本有多个子版本）会被标记，但当前仍线性化展示，分支支持留待后续。
 */
import type { Migration, VersionSummary } from './types'

/** 相邻版本之间的一段连接 */
export interface ChainSegment {
  from: VersionSummary
  to: VersionSummary
  /** 覆盖该段的迁移，为 null 表示缺口 */
  migration: Migration | null
}

export interface VersionChain {
  /** 按链顺序排列的版本（旧 → 新） */
  versions: VersionSummary[]
  /** 相邻版本之间的连接，长度为 versions.length - 1 */
  segments: ChainSegment[]
  /** 缺失迁移的连接 */
  gaps: ChainSegment[]
  /** 是否出现过分叉（同一父版本有多个子版本） */
  branched: boolean
}

/** 按父子关系排序；无 parent_id 时按创建时间排序兜底 */
function orderByParent(versions: VersionSummary[]): {
  ordered: VersionSummary[]
  branched: boolean
} {
  const byTime = [...versions].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  )
  const ids = new Set(byTime.map((v) => v.id))
  const hasParent = byTime.some((v) => v.parent_id && ids.has(v.parent_id))
  if (!hasParent) return { ordered: byTime, branched: false }

  const children = new Map<string, VersionSummary[]>()
  const roots: VersionSummary[] = []
  for (const v of byTime) {
    const parentId = v.parent_id
    if (parentId && ids.has(parentId)) {
      const list = children.get(parentId)
      if (list) list.push(v)
      else children.set(parentId, [v])
    } else {
      roots.push(v)
    }
  }

  const ordered: VersionSummary[] = []
  const visiting = new Set<string>()
  let branched = false

  const walk = (node: VersionSummary) => {
    if (visiting.has(node.id)) return // 环保护
    visiting.add(node.id)
    ordered.push(node)
    const kids = children.get(node.id) ?? []
    if (kids.length > 1) branched = true
    for (const kid of kids) walk(kid)
  }
  for (const root of roots) walk(root)

  // 兜底：未覆盖到的（孤立或成环）按时间追加
  if (ordered.length !== byTime.length) {
    const covered = new Set(ordered.map((v) => v.id))
    for (const v of byTime) if (!covered.has(v.id)) ordered.push(v)
  }

  return { ordered, branched }
}

/** 构建版本链并标注迁移缺口 */
export function buildVersionChain(
  versions: VersionSummary[],
  migrations: Migration[],
): VersionChain {
  const { ordered, branched } = orderByParent(versions)
  const segments: ChainSegment[] = []
  const gaps: ChainSegment[] = []

  for (let i = 0; i < ordered.length - 1; i++) {
    const from = ordered[i]
    const to = ordered[i + 1]
    if (!from || !to) continue
    const migration =
      migrations.find((m) => m.from_version === from.id && m.to_version === to.id) ?? null
    const segment: ChainSegment = { from, to, migration }
    segments.push(segment)
    if (!migration) gaps.push(segment)
  }

  return { versions: ordered, segments, gaps, branched }
}
