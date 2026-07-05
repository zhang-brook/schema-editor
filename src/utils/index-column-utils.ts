import type { IndexColumn } from '@/types/schema'

/**
 * 解析旧版纯字符串列格式 → 新版 IndexColumn
 * "create_time DESC" → { name: "create_time", sort_order: "DESC" }
 * "biz_type" → { name: "biz_type" }
 */
export function parseLegacyColumn(raw: string): IndexColumn {
  const trimmed = raw.trim()
  if (!trimmed) return { name: '' }
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return { name: parts[0]! }
  const last = parts[parts.length - 1]!.toUpperCase()
  if (last === 'ASC' || last === 'DESC') {
    return { name: parts.slice(0, -1).join(' '), sort_order: last }
  }
  return { name: trimmed }
}

/**
 * 批量升级旧版 columns（string[] | IndexColumn[]）→ IndexColumn[]
 */
export function upgradeIndexColumns(columns: string[]): IndexColumn[] {
  return columns.map(c => {
    if (typeof c === 'string') {
      return parseLegacyColumn(c)
    }
    return c
  })
}

/**
 * 将 IndexColumn 格式化为显示用字符串
 * { name: "create_time", sort_order: "DESC" } → "create_time DESC"
 */
export function formatIndexColumn(col: IndexColumn): string {
  if (!col.name.trim()) return ''
  if (col.sort_order) return `${col.name.trim()} ${col.sort_order}`
  return col.name.trim()
}

/**
 * 供 SQL 生成器使用：分离列名和排序部分
 * @returns { name: "create_time", sortPart: " DESC" } （sortPart 带前导空格）
 */
export function splitColumnForSql(col: IndexColumn, db?: 'mysql' | 'postgresql'): { name: string; sortPart: string } {
  let sort = col.sort_order
  if (db === 'mysql' && col.mysql?.sort_order) {
    sort = col.mysql.sort_order
  } else if (db === 'postgresql' && col.postgresql?.sort_order) {
    sort = col.postgresql.sort_order
  }
  return { name: col.name, sortPart: sort ? ` ${sort}` : '' }
}
