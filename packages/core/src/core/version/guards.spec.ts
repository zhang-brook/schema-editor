import { describe, expect, it } from 'vitest'
import type { Environment, Migration } from './types'
import { canDeleteVersion } from './guards'

function migration(id: string, from: string, to: string): Migration {
  return {
    id,
    name: id,
    from_version: from,
    to_version: to,
    renames: [],
    steps: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

function environment(id: string, versionId: string): Environment {
  return {
    id,
    name: id,
    version_id: versionId,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

describe('canDeleteVersion', () => {
  it('can be deleted when unreferenced', () => {
    const result = canDeleteVersion('v1', [migration('m1', 'v2', 'v3')], [environment('e1', 'v2')])
    expect(result.ok).toBe(true)
    expect(result.reasons).toEqual([])
  })

  it('cannot be deleted when used as a migration source version', () => {
    const result = canDeleteVersion('v1', [migration('m1', 'v1', 'v2')], [])
    expect(result.ok).toBe(false)
    expect(result.reasons).toEqual([{ type: 'migration', id: 'm1', name: 'm1', role: 'from' }])
  })

  it('cannot be deleted when used as a migration target version', () => {
    const result = canDeleteVersion('v2', [migration('m1', 'v1', 'v2')], [])
    expect(result.ok).toBe(false)
    expect(result.reasons).toEqual([{ type: 'migration', id: 'm1', name: 'm1', role: 'to' }])
  })

  it('gives two reasons when one migration points to it at both ends', () => {
    const result = canDeleteVersion('v1', [migration('m1', 'v1', 'v1')], [])
    expect(result.reasons).toHaveLength(2)
  })

  it('cannot be deleted when linked to an environment', () => {
    const result = canDeleteVersion('v1', [], [environment('e1', 'v1')])
    expect(result.ok).toBe(false)
    expect(result.reasons).toEqual([{ type: 'environment', id: 'e1', name: 'e1' }])
  })

  it('aggregates all reasons when referenced by both migrations and environments', () => {
    const result = canDeleteVersion(
      'v1',
      [migration('m1', 'v1', 'v2')],
      [environment('e1', 'v1'), environment('e2', 'v1')],
    )
    expect(result.reasons).toHaveLength(3)
  })
})
