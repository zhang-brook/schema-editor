import { describe, it, expect } from 'vitest'
import type { Field } from '../types/schema'
import { stripDisabledFieldMetrics } from './field-utils'

describe('stripDisabledFieldMetrics', () => {
  it('removes field_length when length is disabled, keeping the disabled flag', () => {
    const field: Field = { field_name: 'name', field_type: 'varchar', field_length: 255, field_length_disabled: true }
    expect(stripDisabledFieldMetrics(field)).toEqual({
      field_name: 'name',
      field_type: 'varchar',
      field_length_disabled: true,
    })
  })

  it('removes field_scale when scale is disabled', () => {
    const field: Field = { field_name: 'price', field_length: 10, field_scale: 2, field_scale_disabled: true }
    const next = stripDisabledFieldMetrics(field)
    expect(next.field_scale).toBeUndefined()
    expect(next.field_length).toBe(10)
    expect(next.field_scale_disabled).toBe(true)
  })

  it('returns as-is when not disabled and length/scale are not null, without mutating the input', () => {
    const field: Field = { field_name: 'name', field_length: 64, field_scale: 2 }
    expect(stripDisabledFieldMetrics(field)).toBe(field)
  })

  it('removes field_length when length is cleared to null (values such as 0 are kept)', () => {
    const field: Field = { field_name: 'name', field_type: 'varchar', field_length: null }
    expect(stripDisabledFieldMetrics(field)).toEqual({
      field_name: 'name',
      field_type: 'varchar',
    })
  })

  it('removes field_scale when scale is cleared to null', () => {
    const field: Field = { field_name: 'price', field_length: 10, field_scale: null }
    const next = stripDisabledFieldMetrics(field)
    expect(next.field_scale).toBeUndefined()
    expect(next.field_length).toBe(10)
  })
})
