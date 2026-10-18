import { describe, it, expect } from 'vitest'
import {
  sanitizeName,
  COMMON_FILE,
  SCHEMAS_DIR,
  INITIAL_DATA_DIR,
  OUTPUT_DIR,
  CURRENT_DIR,
  VERSIONS_DIR,
  MIGRATIONS_DIR,
  DATABASE_FILE,
  SCHEMA_FILE,
  TABLE_FILE,
  INITIAL_DATA_FILE,
} from './layout'

describe('layout path constants', () => {
  it('key file and directory names match expectations for old and new layouts', () => {
    expect(COMMON_FILE).toBe('common.json')
    expect(SCHEMAS_DIR).toBe('schemas')
    expect(INITIAL_DATA_DIR).toBe('initial-data')
    expect(OUTPUT_DIR).toBe('output')
    expect(CURRENT_DIR).toBe('current')
    expect(VERSIONS_DIR).toBe('versions')
    expect(MIGRATIONS_DIR).toBe('migrations')
    expect(DATABASE_FILE).toBe('database.json')
    expect(SCHEMA_FILE).toBe('schema.json')
    expect(TABLE_FILE).toBe('table.json')
    expect(INITIAL_DATA_FILE).toBe('initial-data.json')
  })
})

describe('sanitizeName', () => {
  it('keeps regular alphanumerics, hyphens, underscores and dots', () => {
    expect(sanitizeName('user_profile')).toBe('user_profile')
    expect(sanitizeName('order-items.v2')).toBe('order-items.v2')
  })

  it('replaces path separators and illegal characters with underscores', () => {
    expect(sanitizeName('a/b\\c')).toBe('a_b_c')
    expect(sanitizeName('a<b>c:d"e|f?g*h')).toBe('a_b_c_d_e_f_g_h')
  })

  it('collapses consecutive underscores and trims leading and trailing underscores', () => {
    expect(sanitizeName('a//b')).toBe('a_b')
    expect(sanitizeName('__name__')).toBe('name')
    expect(sanitizeName('  name  ')).toBe('name')
  })

  it('returns empty for an empty string', () => {
    expect(sanitizeName('')).toBe('')
  })

  it('preserves the case of the original name', () => {
    expect(sanitizeName('UserTable')).toBe('UserTable')
  })

  it('sanitizes Chinese and spaced file names (only illegal characters are replaced, spaces kept)', () => {
    expect(sanitizeName('用户 / 表')).toBe('用户 _ 表')
  })
})
