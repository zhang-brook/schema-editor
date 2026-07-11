/**
 * 迁移脚本 → 变更 DDL 生成器（MySQL + PostgreSQL 双方言）。
 *
 * 输入：结构 diff（auto_diff 步骤） + clear_column / sql_transform / custom_sql 步骤。
 * 输出：合并后的最终变更 SQL（按方言）。
 *
 * 复用 sql-generator/shared 的字段解析原语，仅新增 ALTER TABLE 片段构造逻辑，
 * 不改动现有全量 DDL 生成器。
 */
import type { CommonConfig, Field } from '@/types/schema'
import type { SqlDialect } from '@/utils/sql-generator/shared'
import {
  resolveFieldTypeForDialect,
  resolveQuoteDefault,
  formatSqlDefault,
} from '@/utils/sql-generator/shared'
import { splitColumnForSql } from '@/utils/index-column-utils'
import { resolveDialectOverride } from '@/utils/dialect-resolver'
import { fmtPrePostSql } from '@/utils/sql-generator/shared'
import type {
  FieldDiff,
  IndexDiff,
  Migration,
  MigrationDdlPreview,
  StructureDiff,
  TableDiff,
} from './types'

const DIALECTS: SqlDialect[] = ['mysql', 'postgresql']

/** 标识符引用（按方言） */
function quoteIdent(dialect: SqlDialect, name: string, commonConfig: CommonConfig | null): string {
  if (dialect === 'mysql') return `\`${name}\``
  const shouldQuote = commonConfig?.default_config?.postgresql?.quote_identifiers ?? true
  return shouldQuote ? `"${name}"` : name
}

/** 生成单字段定义片段（用于 ADD COLUMN），返回不含前缀的片段，如 `name VARCHAR(255) NOT NULL` */
function getFieldDefinition(
  dialect: SqlDialect,
  field: Field,
  commonConfig: CommonConfig | null,
  tableName: string,
): string {
  const qName = quoteIdent(dialect, field.field_name, commonConfig)
  const resolved = resolveFieldTypeForDialect(field, dialect, commonConfig)
  const fieldType = resolved.type
  const fieldLength = resolved.length
  const fieldScale = resolved.scale
  let def = qName
  if (fieldType) {
    if (typeof fieldScale === 'number' && typeof fieldLength === 'number') {
      def += ` ${fieldType}(${fieldLength},${fieldScale})`
    } else if (typeof fieldLength === 'number') {
      def += ` ${fieldType}(${fieldLength})`
    } else {
      def += ` ${fieldType}`
    }
  }

  if (field.not_null) def += ' NOT NULL'

  const defaultValue = resolveDialectOverride(field, dialect, 'default')
  if (defaultValue !== undefined) {
    if (typeof defaultValue === 'string' && (defaultValue === 'CURRENT_TIMESTAMP' || defaultValue.includes('CURRENT_TIMESTAMP'))) {
      def += ` DEFAULT ${defaultValue}`
    } else {
      const shouldQuote = resolveQuoteDefault(field, commonConfig)
      def += ` DEFAULT ${formatSqlDefault(defaultValue, shouldQuote)}`
    }
  }

  if (dialect === 'mysql' && field.comment) {
    def += ` COMMENT '${field.comment.replace(/'/g, "''")}'`
  }
  void tableName
  return def
}

/** 生成单字段的完整 ALTER ADD（含 COMMENT ON 语句，PG 风格） */
function buildAddColumn(
  dialect: SqlDialect,
  schemaName: string,
  tableName: string,
  field: Field,
  commonConfig: CommonConfig | null,
): string {
  const qTable = `${quoteIdent(dialect, schemaName, commonConfig)}.${quoteIdent(dialect, tableName, commonConfig)}`
  const lines: string[] = []
  lines.push(`ALTER TABLE ${qTable} ADD COLUMN ${getFieldDefinition(dialect, field, commonConfig, tableName)};`)
  if (dialect === 'postgresql' && field.comment) {
    lines.push(`COMMENT ON COLUMN ${qTable}.${quoteIdent(dialect, field.field_name, commonConfig)} IS '${field.comment.replace(/'/g, "''")}';`)
  }
  return lines.join('\n')
}

function buildDropColumn(
  dialect: SqlDialect,
  schemaName: string,
  tableName: string,
  columnName: string,
  commonConfig: CommonConfig | null,
): string {
  const qTable = `${quoteIdent(dialect, schemaName, commonConfig)}.${quoteIdent(dialect, tableName, commonConfig)}`
  return `ALTER TABLE ${qTable} DROP COLUMN ${quoteIdent(dialect, columnName, commonConfig)};`
}

function buildRenameColumn(
  dialect: SqlDialect,
  schemaName: string,
  tableName: string,
  oldName: string,
  newName: string,
  commonConfig: CommonConfig | null,
): string {
  const qTable = `${quoteIdent(dialect, schemaName, commonConfig)}.${quoteIdent(dialect, tableName, commonConfig)}`
  const qOld = quoteIdent(dialect, oldName, commonConfig)
  const qNew = quoteIdent(dialect, newName, commonConfig)
  if (dialect === 'mysql') {
    // MySQL 8 使用 RENAME COLUMN
    return `ALTER TABLE ${qTable} RENAME COLUMN ${qOld} TO ${qNew};`
  }
  return `ALTER TABLE ${qTable} RENAME COLUMN ${qOld} TO ${qNew};`
}

/** 修改字段属性（类型/长度/默认值/非空/注释等） */
function buildModifyColumn(
  dialect: SqlDialect,
  schemaName: string,
  tableName: string,
  field: Field,
  commonConfig: CommonConfig | null,
): string {
  const qTable = `${quoteIdent(dialect, schemaName, commonConfig)}.${quoteIdent(dialect, tableName, commonConfig)}`
  const lines: string[] = []
  if (dialect === 'mysql') {
    lines.push(`ALTER TABLE ${qTable} MODIFY COLUMN ${getFieldDefinition(dialect, field, commonConfig, tableName)};`)
  } else {
    // PostgreSQL：类型与约束分开
    const resolved = resolveFieldTypeForDialect(field, dialect, commonConfig)
    if (resolved.type) {
      let typeStr = resolved.type
      if (typeof resolved.scale === 'number' && typeof resolved.length === 'number') {
        typeStr += `(${resolved.length},${resolved.scale})`
      } else if (typeof resolved.length === 'number') {
        typeStr += `(${resolved.length})`
      }
      lines.push(`ALTER TABLE ${qTable} ALTER COLUMN ${quoteIdent(dialect, field.field_name, commonConfig)} TYPE ${typeStr};`)
    }
    lines.push(`ALTER TABLE ${qTable} ALTER COLUMN ${quoteIdent(dialect, field.field_name, commonConfig)} ${field.not_null ? 'SET NOT NULL' : 'DROP NOT NULL'};`)
    if (dialect === 'postgresql' && field.comment !== undefined) {
      lines.push(`COMMENT ON COLUMN ${qTable}.${quoteIdent(dialect, field.field_name, commonConfig)} IS '${String(field.comment ?? '').replace(/'/g, "''")}';`)
    }
  }
  return lines.join('\n')
}

/** 索引定义片段（按方言） */
function buildIndexDefinition(
  dialect: SqlDialect,
  index: { name?: string; type: string; using?: string; columns: { name: string; sort_order?: 'ASC' | 'DESC'; mysql?: any; postgresql?: any }[] },
  commonConfig: CommonConfig | null,
): string {
  let indexName = index.name
  let indexType = index.type
  let indexUsing = index.using
  if (dialect === 'mysql' && (index as any).mysql) {
    indexName = (index as any).mysql.name || indexName
    indexType = (index as any).mysql.type || indexType
    indexUsing = (index as any).mysql.using || indexUsing
  }
  if (dialect === 'postgresql' && (index as any).postgresql) {
    indexName = (index as any).postgresql.name || indexName
    indexType = (index as any).postgresql.type || indexType
    indexUsing = (index as any).postgresql.using || indexUsing
  }
  indexName = (indexName ?? '').replace('{pre}', indexType === 'unique' ? 'uk_' : 'idx_').replace('{post}', '') || (indexType === 'unique' ? 'uk_col' : 'idx_col')

  const finalIndexUsing = indexUsing ? ` USING ${indexUsing.toUpperCase()}` : ''
  const colList = index.columns.map(c => {
    const { name, sortPart } = splitColumnForSql(c as any, dialect)
    return quoteIdent(dialect, name, commonConfig) + sortPart
  }).join(', ')

  if (indexType === 'unique') {
    return `CREATE UNIQUE INDEX ${quoteIdent(dialect, indexName, commonConfig)} ON ${colList}${finalIndexUsing};`
  }
  return `CREATE INDEX ${quoteIdent(dialect, indexName, commonConfig)} ON ${colList}${finalIndexUsing};`
}

// ===== diff → DDL =====

/** 查找某 schema 下某表的完整 Table 定义（来自目标结构） */
function findTable(
  schemas: StructureDiff['schemas'],
  schemaName: string,
  tableName: string,
): TableDiff | undefined {
  const sd = schemas.find(s => s.schema === schemaName)
  return sd?.tables.find(t => t.new_name === tableName || t.old_name === tableName)
}

/**
 * 根据结构 diff 生成两方言的变更 DDL（auto_diff 部分）。
 * 需要传入「目标结构完整 schema 定义」以拿到字段/索引的完整属性。
 */
function generateDiffDdl(
  diff: StructureDiff,
  targetSchemas: import('@/types/schema').Schema[],
  commonConfig: CommonConfig | null,
): { mysql: string[]; postgresql: string[] } {
  const out: { mysql: string[]; postgresql: string[] } = { mysql: [], postgresql: [] }

  for (const sd of diff.schemas) {
    for (const td of sd.tables) {
      for (const dialect of DIALECTS) {
        const lines = dialect === 'mysql' ? out.mysql : out.postgresql
        if (td.type === 'table_added' || td.type === 'table_renamed') {
          // 新增表的完整 CREATE（复用现有生成器更稳妥，但这里仅做 ALTER 体系，新增表用简化 CREATE）
          const targetTable = findTargetTable(targetSchemas, sd.schema, td.new_name!)
          if (targetTable && td.type === 'table_added') {
            lines.push(...buildCreateTable(dialect, sd.schema, targetTable, commonConfig))
          }
          // rename 表名
          if (td.type === 'table_renamed' && td.old_name && td.new_name) {
            const qOld = `${quoteIdent(dialect, sd.schema, commonConfig)}.${quoteIdent(dialect, td.old_name, commonConfig)}`
            const qNew = quoteIdent(dialect, td.new_name, commonConfig)
            lines.push(`ALTER TABLE ${qOld} RENAME TO ${qNew};`)
          }
          // 内部字段/索引变更（rename 场景）
          for (const fd of td.fields) lines.push(...buildFieldDdl(dialect, sd.schema, td.new_name!, fd, targetSchemas))
          for (const id of td.indexes) lines.push(...buildIndexDdl(dialect, sd.schema, td.new_name!, id, targetSchemas))
        } else if (td.type === 'table_removed') {
          const qTable = `${quoteIdent(dialect, sd.schema, commonConfig)}.${quoteIdent(dialect, td.old_name!, commonConfig)}`
          lines.push(`DROP TABLE ${qTable};`)
        }
      }
    }
  }
  return out
}

function findTargetTable(
  schemas: import('@/types/schema').Schema[],
  schemaName: string,
  tableName: string,
): import('@/types/schema').Table | undefined {
  const s = schemas.find(x => x.schema === schemaName)
  return s?.tables.find(t => t.name === tableName)
}

function buildCreateTable(
  dialect: SqlDialect,
  schemaName: string,
  table: import('@/types/schema').Table,
  commonConfig: CommonConfig | null,
): string[] {
  const qTable = `${quoteIdent(dialect, schemaName, commonConfig)}.${quoteIdent(dialect, table.name, commonConfig)}`
  const lines: string[] = []
  lines.push(`-- Create table ${schemaName}.${table.name}`)
  let stmt = `CREATE TABLE ${qTable} (\n`
  const defs: string[] = table.fields.map(f => `  ${getFieldDefinition(dialect, f, commonConfig, table.name)}`)
  const pk = table.fields.find(f => f.primary_key)
  if (pk) defs.push(`  PRIMARY KEY (${quoteIdent(dialect, pk.field_name, commonConfig)})`)
  stmt += defs.join(',\n')
  stmt += '\n);'
  lines.push(stmt)
  for (const idx of table.indexes) {
    lines.push(buildIndexDefinition(dialect, idx as any, commonConfig))
  }
  return lines
}

function buildFieldDdl(
  dialect: SqlDialect,
  schemaName: string,
  tableName: string,
  fd: FieldDiff,
  targetSchemas: import('@/types/schema').Schema[],
): string[] {
  const targetTable = findTargetTable(targetSchemas, schemaName, tableName)
  if (!targetTable) return []
  switch (fd.type) {
    case 'field_added': {
      const f = targetTable.fields.find(x => x.field_name === fd.new_name || (fd.field_id && x.field_id === fd.field_id))
      if (f) return [buildAddColumn(dialect, schemaName, tableName, f, null)]
      return []
    }
    case 'field_removed':
      return [buildDropColumn(dialect, schemaName, tableName, fd.old_name!, null)]
    case 'field_renamed':
      return [buildRenameColumn(dialect, schemaName, tableName, fd.old_name!, fd.new_name!, null)]
    case 'field_modified': {
      const f = targetTable.fields.find(x => x.field_name === fd.new_name || (fd.field_id && x.field_id === fd.field_id))
      if (f) return [buildModifyColumn(dialect, schemaName, tableName, f, null)]
      return []
    }
    default:
      return []
  }
}

function buildIndexDdl(
  dialect: SqlDialect,
  schemaName: string,
  tableName: string,
  id: IndexDiff,
  targetSchemas: import('@/types/schema').Schema[],
): string[] {
  const targetTable = findTargetTable(targetSchemas, schemaName, tableName)
  if (!targetTable) return []
  if (id.type === 'index_added' || id.type === 'index_modified') {
    const idx = (id.index_id && targetTable.indexes.find(x => x.index_id === id.index_id)) ||
      targetTable.indexes.find(x => x.name === id.new_name)
    if (idx) return [buildIndexDefinition(dialect, idx as any, null)]
    return []
  }
  if (id.type === 'index_removed') {
    const idxName = id.old_name || 'idx_col'
    return [`DROP INDEX ${quoteIdent(dialect, idxName, null)};`]
  }
  return []
}

// ===== 顶层：合并所有步骤 → 最终预览 =====

/**
 * 根据迁移脚本（steps）与目标结构生成最终合并 DDL。
 * @param migration 迁移脚本定义
 * @param diff 已计算的两个基线的结构 diff（供 auto_diff 步骤使用）
 * @param targetSchemas 目标结构完整 schema 定义
 * @param commonConfig 公共配置（用于类型解析、标识符引用）
 */
export function generateMigrationDdl(
  migration: Migration,
  diff: StructureDiff,
  targetSchemas: import('@/types/schema').Schema[],
  commonConfig: CommonConfig | null,
): MigrationDdlPreview {
  const acc: { mysql: string[]; postgresql: string[] } = { mysql: [], postgresql: [] }

  for (const step of migration.steps) {
    switch (step.type) {
      case 'auto_diff': {
        const diffDdl = generateDiffDdl(diff, targetSchemas, commonConfig)
        for (const dialect of DIALECTS) {
          const lines = dialect === 'mysql' ? acc.mysql : acc.postgresql
          const ddl = dialect === 'mysql' ? diffDdl.mysql : diffDdl.postgresql
          if (lines.length > 0) lines.push('')
          lines.push(`-- ===== auto diff (${migration.from_baseline} → ${migration.to_baseline}) =====`)
          lines.push(...ddl)
        }
        break
      }
      case 'clear_column': {
        for (const dialect of DIALECTS) {
          const qTable = `${quoteIdent(dialect, step.schema, commonConfig)}.${quoteIdent(dialect, step.table, commonConfig)}`
          const lines = dialect === 'mysql' ? acc.mysql : acc.postgresql
          lines.push(`-- clear column ${step.schema}.${step.table}.${step.column}`)
          lines.push(`UPDATE ${qTable} SET ${quoteIdent(dialect, step.column, commonConfig)} = NULL;`)
        }
        break
      }
      case 'sql_transform': {
        if (step.mysql) acc.mysql.push(fmtPrePostSql(step.mysql).trimEnd())
        if (step.postgresql) acc.postgresql.push(fmtPrePostSql(step.postgresql).trimEnd())
        // 若仅提供通用片段（无方言键），两方言复用
        if (!step.mysql && !step.postgresql) {
          // 无内容
        }
        break
      }
      case 'custom_sql': {
        if (step.mysql) acc.mysql.push(step.mysql)
        if (step.postgresql) acc.postgresql.push(step.postgresql)
        if (!step.mysql && !step.postgresql) {
          // 空步骤跳过
        }
        break
      }
    }
  }

  return {
    mysql: acc.mysql.join('\n').trimEnd() + '\n',
    postgresql: acc.postgresql.join('\n').trimEnd() + '\n',
  }
}
