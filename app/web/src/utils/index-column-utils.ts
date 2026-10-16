import type { Index, IndexColumn } from '@/types/schema'
import { resolveDialectOverride } from '@/utils/dialect-resolver'
import type { SqlDialect } from '@/utils/sql-generator/shared'

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
export function splitColumnForSql(col: IndexColumn, db?: SqlDialect): { name: string; sortPart: string } {
  const sort = db === undefined
    ? col.sort_order
    : resolveDialectOverride(col, db, 'sort_order', col.sort_order)
  return { name: col.name, sortPart: sort ? ` ${sort}` : '' }
}

/** 删除字段时同步清理索引引用的动作（供命令模式 apply/revert 使用） */
export interface IndexFieldRemoval {
  /** 执行清理：可重复调用，内部先回滚上一次的清理结果 */
  apply(): void
  /** 回滚：恢复被移除的列，以及被整体移除的索引（含原位置） */
  restore(): void
}

/**
 * 删除字段时同步清理索引中对该字段的引用：
 * - 索引含该列 → 移除该列；
 * - 移除后索引无任何列 → 整个索引一并移除。
 *
 * 纯函数式（只操作传入的 indexes 数组），返回 apply/restore 两个动作，
 * 供命令模式在 apply/revert 中配对调用以完整支持撤销/重做。
 */
export function createIndexFieldRemoval(indexes: Index[], fieldName: string): IndexFieldRemoval {
  /** 被改动索引的列快照（按下标从大到小记录） */
  const snapshots: { index: Index; indexIdx: number; columns: IndexColumn[] }[] = []
  /** 因清空而被整体移除的索引 */
  const removedIndexes: { index: Index; indexIdx: number }[] = []

  function restore() {
    // 逆序遍历即按下标升序放回，保证多个索引同时被移除时位置正确
    for (let i = removedIndexes.length - 1; i >= 0; i--) {
      const item = removedIndexes[i]!
      if (!indexes.includes(item.index)) indexes.splice(item.indexIdx, 0, item.index)
    }
    removedIndexes.length = 0
    for (const s of snapshots) {
      s.index.columns = s.columns
    }
    snapshots.length = 0
  }

  function apply() {
    restore()
    if (!fieldName) return
    // 倒序遍历，保证 splice 不影响尚未处理的下标
    for (let i = indexes.length - 1; i >= 0; i--) {
      const index = indexes[i]
      if (!index?.columns) continue
      if (!index.columns.some(c => c.name === fieldName)) continue
      snapshots.push({ index, indexIdx: i, columns: index.columns.map(c => ({ ...c })) })
      index.columns = index.columns.filter(c => c.name !== fieldName)
      if (index.columns.length === 0) {
        indexes.splice(i, 1)
        removedIndexes.push({ index, indexIdx: i })
      }
    }
  }

  return { apply, restore }
}
