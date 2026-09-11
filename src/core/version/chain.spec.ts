import { describe, expect, it } from 'vitest'
import type { Migration, VersionSummary } from './types'
import { buildVersionChain } from './chain'

function version(id: string, createdAt: string, parentId?: string): VersionSummary {
  return {
    id,
    name: id.toUpperCase(),
    created_at: createdAt,
    ...(parentId ? { parent_id: parentId } : {}),
  }
}

function migration(from: string, to: string): Migration {
  return {
    id: `m_${from}_${to}`,
    name: `${from} → ${to}`,
    from_version: from,
    to_version: to,
    renames: [],
    steps: [],
    created_at: '2026-01-02T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
  }
}

describe('buildVersionChain', () => {
  it('空版本集合返回空链', () => {
    const chain = buildVersionChain([], [])
    expect(chain.versions).toEqual([])
    expect(chain.segments).toEqual([])
    expect(chain.gaps).toEqual([])
  })

  it('无 parent_id 时按创建时间排序', () => {
    const chain = buildVersionChain(
      [version('v3', '2026-03-01'), version('v1', '2026-01-01'), version('v2', '2026-02-01')],
      [],
    )
    expect(chain.versions.map((v) => v.id)).toEqual(['v1', 'v2', 'v3'])
    expect(chain.branched).toBe(false)
  })

  it('有 parent_id 时按父子关系串联', () => {
    const chain = buildVersionChain(
      [
        version('v1', '2026-01-01'),
        version('v3', '2026-03-01', 'v2'),
        version('v2', '2026-02-01', 'v1'),
      ],
      [],
    )
    expect(chain.versions.map((v) => v.id)).toEqual(['v1', 'v2', 'v3'])
  })

  it('标注相邻版本之间缺失的迁移', () => {
    const chain = buildVersionChain(
      [
        version('v1', '2026-01-01'),
        version('v2', '2026-02-01', 'v1'),
        version('v3', '2026-03-01', 'v2'),
      ],
      [migration('v1', 'v2')],
    )
    expect(chain.segments).toHaveLength(2)
    expect(chain.gaps).toHaveLength(1)
    expect(chain.gaps[0]).toMatchObject({ from: { id: 'v2' }, to: { id: 'v3' } })
  })

  it('存在对应迁移时不计为缺口', () => {
    const chain = buildVersionChain(
      [version('v1', '2026-01-01'), version('v2', '2026-02-01', 'v1')],
      [migration('v1', 'v2')],
    )
    expect(chain.gaps).toEqual([])
  })

  it('同一父版本有多个子版本时标记为分叉', () => {
    const chain = buildVersionChain(
      [
        version('v1', '2026-01-01'),
        version('v2', '2026-02-01', 'v1'),
        version('v2h', '2026-02-02', 'v1'),
      ],
      [],
    )
    expect(chain.branched).toBe(true)
    expect(chain.versions.map((v) => v.id)).toEqual(['v1', 'v2', 'v2h'])
  })

  it('parent_id 成环时不丢失版本', () => {
    const chain = buildVersionChain(
      [version('v1', '2026-01-01', 'v2'), version('v2', '2026-02-01', 'v1')],
      [],
    )
    expect(chain.versions).toHaveLength(2)
  })
})
