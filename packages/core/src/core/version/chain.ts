/**
 * Version chain: threads discrete versions into a linear timeline via parent-child links and flags
 * migrations missing between adjacent versions.
 *
 * Versions record parent_id on their snapshots, and the chain is derived from it; early versions
 * have no parent_id, so they fall back to created_at ordering, matching the previous behavior.
 * Forks (one parent version with multiple children) are flagged but still displayed linearly for now;
 * branch support is left for later.
 */
import type { Migration, VersionSummary } from './types'

/** A link between two adjacent versions */
export interface ChainSegment {
  from: VersionSummary
  to: VersionSummary
  /** Migration covering this segment; null means a gap */
  migration: Migration | null
}

export interface VersionChain {
  /** Versions in chain order (old → new) */
  versions: VersionSummary[]
  /** Links between adjacent versions; length is versions.length - 1 */
  segments: ChainSegment[]
  /** Links missing a migration */
  gaps: ChainSegment[]
  /** Whether a fork ever occurred (one parent version with multiple children) */
  branched: boolean
}

/** Order by parent-child links; falls back to creation time when no parent_id exists */
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
    if (visiting.has(node.id)) return // cycle guard
    visiting.add(node.id)
    ordered.push(node)
    const kids = children.get(node.id) ?? []
    if (kids.length > 1) branched = true
    for (const kid of kids) walk(kid)
  }
  for (const root of roots) walk(root)

  // Fallback: append anything not covered (orphans or cycles) in time order
  if (ordered.length !== byTime.length) {
    const covered = new Set(ordered.map((v) => v.id))
    for (const v of byTime) if (!covered.has(v.id)) ordered.push(v)
  }

  return { ordered, branched }
}

/** Build the version chain and flag missing migrations */
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
