// 逻辑删除解析层：把「项目级配置 + 索引级覆盖」解析为各方言可直接使用的落地参数。
//
// 背景：唯一索引只看物理行，不管业务上的「已删除」，软删除后相同业务键再插入会撞 Duplicate entry。
// 本模块统一收敛「怎么绕」的决策，避免每张表每个索引重复配置。

import type { CommonConfig, Index, LogicalDeleteConfig, LogicalDeleteMysqlStrategy, Table } from '@/types/schema'
import { resolveDialectOverride } from '@/utils/dialect-resolver'
import { getTableColumnNames } from '@/utils/sql-generator/shared'
import type { SqlDialect } from '@/utils/sql-generator/shared'

/** 解析后可直接用于 SQL 生成的逻辑删除参数 */
export interface ResolvedLogicalDelete {
  /** 逻辑删除字段名（已确认存在于表中） */
  field: string
  /** 「未删除」判定谓词（不含 WHERE 关键字），供 PostgreSQL / SQLite 部分索引使用 */
  predicate: string
  /** MySQL 落地策略 */
  mysqlStrategy: LogicalDeleteMysqlStrategy
}

/**
 * 合并项目级与索引级配置：索引级逐键覆盖，未配置的键回退项目级。
 * 两侧都未配置时返回空对象。
 */
export function mergeLogicalDelete(
  index: Index,
  commonConfig: CommonConfig | null,
): LogicalDeleteConfig {
  const project = commonConfig?.logical_delete ?? {}
  const own = index.logical_delete ?? {}
  return { ...project, ...own }
}

/** 由字段名推导「未删除」谓词：含 delete / del 的字段 → IS NULL，其余 → = 0 */
export function deriveDeletePredicate(field: string): string {
  if (!field) return ''
  return /delet|del_|_del/i.test(field) ? `${field} IS NULL` : `${field} = 0`
}

/**
 * 判定某个索引在指定表中是否需要做逻辑删除处理。
 *
 * 生效条件（缺一即降级为普通唯一索引）：
 * 1. 该方言下解析出的索引类型为 unique（普通索引无唯一性冲突问题）
 * 2. 索引勾选了 active_only
 * 3. 合并后的配置 enabled === true 且字段名非空
 * 4. 表中真实存在该字段（已排除 is_commented_out 的字段）
 */
export function resolveIndexLogicalDelete(
  index: Index,
  table: Table,
  dialect: SqlDialect,
  commonConfig: CommonConfig | null,
): ResolvedLogicalDelete | null {
  const indexType = resolveDialectOverride(index, dialect, 'type', index.type)
  if (indexType !== 'unique') return null
  if (index.active_only !== true) return null

  const cfg = mergeLogicalDelete(index, commonConfig)
  if (cfg.enabled !== true) return null

  const field = (cfg.field ?? '').trim()
  if (!field) return null
  if (!getTableColumnNames(table, commonConfig).includes(field)) return null

  const predicate = (cfg.predicate ?? '').trim() || deriveDeletePredicate(field)
  return {
    field,
    predicate,
    mysqlStrategy: cfg.mysql_strategy === 'timestamp_union' ? 'timestamp_union' : 'functional',
  }
}

/**
 * 生成 MySQL 函数索引中单个索引列的表达式：`IF(<field> IS NULL, <col>, NULL)`。
 * 已删除行映射为 NULL，而唯一索引中多个 NULL 互不冲突，从而释放唯一性。
 */
export function buildMysqlActiveExpression(columnName: string, deleteField: string): string {
  return `IF(\`${deleteField}\` IS NULL, \`${columnName}\`, NULL)`
}
