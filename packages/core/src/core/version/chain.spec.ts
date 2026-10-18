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
  it('returns an empty chain for an empty version set', () => {
    const chain = buildVersionChain([], [])
    expect(chain.versions).toEqual([])
    expect(chain.segments).toEqual([])
    expect(chain.gaps).toEqual([])
  })

  it('sorts by creation time when there is no parent_id', () => {
    const chain = buildVersionChain(
      [version('v3', '2026-03-01'), version('v1', '2026-01-01'), version('v2', '2026-02-01')],
      [],
    )
    expect(chain.versions.map((v) => v.id)).toEqual(['v1', 'v2', 'v3'])
    expect(chain.branched).toBe(false)
  })

  it('chains versions by parent-child relationships when parent_id exists', () => {
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

  it('flags migrations missing between adjacent versions', () => {
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

  it('does not report a gap when the matching migration exists', () => {
    const chain = buildVersionChain(
      [version('v1', '2026-01-01'), version('v2', '2026-02-01', 'v1')],
      [migration('v1', 'v2')],
    )
    expect(chain.gaps).toEqual([])
  })

  it('marks a fork when one parent version has multiple children', () => {
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

  it('does not lose versions when parent_id forms a cycle', () => {
    const chain = buildVersionChain(
      [version('v1', '2026-01-01', 'v2'), version('v2', '2026-02-01', 'v1')],
      [],
    )
    expect(chain.versions).toHaveLength(2)
  })
})
