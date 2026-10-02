import { describe, it, expect } from 'vitest'
import type { Field } from '@/types/schema'
import { stripDisabledFieldMetrics } from './field-utils'

describe('stripDisabledFieldMetrics', () => {
  it('禁用长度时移除 field_length，保留禁用标记', () => {
    const field: Field = { field_name: 'name', field_type: 'varchar', field_length: 255, field_length_disabled: true }
    expect(stripDisabledFieldMetrics(field)).toEqual({
      field_name: 'name',
      field_type: 'varchar',
      field_length_disabled: true,
    })
  })

  it('禁用小数位时移除 field_scale', () => {
    const field: Field = { field_name: 'price', field_length: 10, field_scale: 2, field_scale_disabled: true }
    const next = stripDisabledFieldMetrics(field)
    expect(next.field_scale).toBeUndefined()
    expect(next.field_length).toBe(10)
    expect(next.field_scale_disabled).toBe(true)
  })

  it('未禁用且长度/小数位非 null 时原样返回，且不修改入参', () => {
    const field: Field = { field_name: 'name', field_length: 64, field_scale: 2 }
    expect(stripDisabledFieldMetrics(field)).toBe(field)
  })

  it('长度清空为 null 时移除 field_length（保留 0 等值）', () => {
    const field: Field = { field_name: 'name', field_type: 'varchar', field_length: null }
    expect(stripDisabledFieldMetrics(field)).toEqual({
      field_name: 'name',
      field_type: 'varchar',
    })
  })

  it('小数位清空为 null 时移除 field_scale', () => {
    const field: Field = { field_name: 'price', field_length: 10, field_scale: null }
    const next = stripDisabledFieldMetrics(field)
    expect(next.field_scale).toBeUndefined()
    expect(next.field_length).toBe(10)
  })
})
