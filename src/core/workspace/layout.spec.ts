import { describe, it, expect } from 'vitest'
import {
  sanitizeName,
  COMMON_FILE,
  SCHEMAS_DIR,
  INITIAL_DATA_DIR,
  OUTPUT_DIR,
  CURRENT_DIR,
  BASELINES_DIR,
  MIGRATIONS_DIR,
  DATABASE_FILE,
  SCHEMA_FILE,
  TABLE_FILE,
  INITIAL_DATA_FILE,
} from './layout'

describe('layout 路径常量', () => {
  it('新旧结构关键文件名/目录名符合预期', () => {
    expect(COMMON_FILE).toBe('common.json')
    expect(SCHEMAS_DIR).toBe('schemas')
    expect(INITIAL_DATA_DIR).toBe('initial-data')
    expect(OUTPUT_DIR).toBe('output')
    expect(CURRENT_DIR).toBe('current')
    expect(BASELINES_DIR).toBe('baselines')
    expect(MIGRATIONS_DIR).toBe('migrations')
    expect(DATABASE_FILE).toBe('database.json')
    expect(SCHEMA_FILE).toBe('schema.json')
    expect(TABLE_FILE).toBe('table.json')
    expect(INITIAL_DATA_FILE).toBe('initial-data.json')
  })
})

describe('sanitizeName', () => {
  it('保留常规字母数字与中划线/下划线/点', () => {
    expect(sanitizeName('user_profile')).toBe('user_profile')
    expect(sanitizeName('order-items.v2')).toBe('order-items.v2')
  })

  it('将路径分隔符与非法字符替换为下划线', () => {
    expect(sanitizeName('a/b\\c')).toBe('a_b_c')
    expect(sanitizeName('a<b>c:d"e|f?g*h')).toBe('a_b_c_d_e_f_g_h')
  })

  it('折叠连续下划线并去除首尾下划线', () => {
    expect(sanitizeName('a//b')).toBe('a_b')
    expect(sanitizeName('__name__')).toBe('name')
    expect(sanitizeName('  name  ')).toBe('name')
  })

  it('空字符串返回空', () => {
    expect(sanitizeName('')).toBe('')
  })

  it('保留原名称大小写', () => {
    expect(sanitizeName('UserTable')).toBe('UserTable')
  })

  it('处理中文与空格文件名友好化（仅替换非法字符，空格保留）', () => {
    expect(sanitizeName('用户 / 表')).toBe('用户 _ 表')
  })
})
