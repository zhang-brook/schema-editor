/**
 * 迁移脚本 → 变更 DDL 生成器（MySQL + PostgreSQL + SQLite 三方言）。
 *
 * 输入：结构 diff（auto_diff 步骤） + clear_column / sql_transform / custom_sql 步骤。
 * 输出：合并后的最终变更 SQL（按方言）。
 *
 * 复用 sql-generator/shared 的字段解析原语，仅新增 ALTER TABLE 片段构造逻辑，
 * 不改动现有全量 DDL 生成器。
 *
 * SQLite 的 ALTER 能力有限（仅 ADD COLUMN / DROP COLUMN / RENAME COLUMN / RENAME TO，
 * 且无 schema 前缀、无 USING 子句），修改列属性需重建表，故此处输出提示性注释。
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

const DIALECTS: SqlDialect[] = ['mysql', 'postgresql', 'sqlite']

/** 标识符引用（按方言） */
function quoteIdent(dialect: SqlDialect, name: string, commonConfig: CommonConfig | null): string {
  if (dialect === 'mysql') {
    return `\`${name}\``
  }
  else if (dialect === 'postgresql') {
    const shouldQuote = commonConfig?.default_config?.postgresql?.quote_identifiers ?? true
    return shouldQuote ? `"${name}"` : name
  }
  else if (dialect === 'sqlite') {
    const shouldQuote = commonConfig?.default_config?.sqlite?.quote_identifiers ?? true
    return shouldQuote ? `"${name}"` : name
  }
  return ''
}

/**
 * 表名限定（按方言）。
 * SQLite 无 schema 概念（schema 对应数据库文件），不加 schema 前缀。
 */
function qualifyTable(
  dialect: SqlDialect,
  schemaName: string,
  tableName: string,
  commonConfig: CommonConfig | null,
): string {
  if (dialect === 'sqlite') return quoteIdent(dialect, tableName, commonConfig)
  return `${quoteIdent(dialect, schemaName, commonConfig)}.${quoteIdent(dialect, tableName, commonConfig)}`
}

/** 按方言累积 DDL 片段的容器 */
type DialectLines = Record<SqlDialect, string[]>

function emptyDialectLines(): DialectLines {
  return {
    mysql: [],
    postgresql: [],
    sqlite: [],
  }
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
  const qTable = qualifyTable(dialect, schemaName, tableName, commonConfig)
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
  const qTable = qualifyTable(dialect, schemaName, tableName, commonConfig)
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
  const qTable = qualifyTable(dialect, schemaName, tableName, commonConfig)
  const qOld = quoteIdent(dialect, oldName, commonConfig)
  const qNew = quoteIdent(dialect, newName, commonConfig)
  // MySQL 8 / PostgreSQL / SQLite(3.25+) 统一使用 RENAME COLUMN
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
  const qTable = qualifyTable(dialect, schemaName, tableName, commonConfig)
  const qColumn = quoteIdent(dialect, field.field_name, commonConfig)
  const lines: string[] = []

  if (dialect === 'mysql') {
    lines.push(`ALTER TABLE ${qTable} MODIFY COLUMN ${getFieldDefinition(dialect, field, commonConfig, tableName)};`)
    return lines.join('\n')
  }

  if (dialect === 'postgresql') {
    // PostgreSQL：类型与约束分开
    const resolved = resolveFieldTypeForDialect(field, dialect, commonConfig)
    if (resolved.type) {
      let typeStr = resolved.type
      if (typeof resolved.scale === 'number' && typeof resolved.length === 'number') {
        typeStr += `(${resolved.length},${resolved.scale})`
      } else if (typeof resolved.length === 'number') {
        typeStr += `(${resolved.length})`
      }
      lines.push(`ALTER TABLE ${qTable} ALTER COLUMN ${qColumn} TYPE ${typeStr};`)
    }
    lines.push(`ALTER TABLE ${qTable} ALTER COLUMN ${qColumn} ${field.not_null ? 'SET NOT NULL' : 'DROP NOT NULL'};`)
    if (field.comment !== undefined) {
      lines.push(`COMMENT ON COLUMN ${qTable}.${qColumn} IS '${String(field.comment ?? '').replace(/'/g, "''")}';`)
    }
    return lines.join('\n')
  }

  if (dialect === 'sqlite') {
    // SQLite 的 ALTER TABLE 不支持修改列属性，只能「建新表 → 搬数据 → 换名 → 删旧表」
    const resolved = resolveFieldTypeForDialect(field, dialect, commonConfig)
    let typeStr = resolved.type
    if (typeof resolved.scale === 'number' && typeof resolved.length === 'number') {
      typeStr += `(${resolved.length},${resolved.scale})`
    } else if (typeof resolved.length === 'number') {
      typeStr += `(${resolved.length})`
    }
    lines.push(`-- [SQLite] 修改列属性需重建表：ALTER TABLE 仅支持 RENAME / ADD COLUMN / DROP COLUMN`)
    lines.push(`-- 目标列定义：${qColumn} ${typeStr}${field.not_null ? ' NOT NULL' : ''}`)
    lines.push(`-- 推荐步骤（请按实际表结构补全列清单与 INSERT ... SELECT 的列映射）：`)
    lines.push(`--   1. ALTER TABLE ${qTable} RENAME TO ${quoteIdent(dialect, `${tableName}_old`, commonConfig)};`)
    lines.push(`--   2. 用建表生成器重新生成 ${quoteIdent(dialect, tableName, commonConfig)} 的 CREATE TABLE 并执行`)
    lines.push(`--   3. INSERT INTO ${qTable} SELECT ... FROM ${quoteIdent(dialect, `${tableName}_old`, commonConfig)};`)
    lines.push(`--   4. DROP TABLE ${quoteIdent(dialect, `${tableName}_old`, commonConfig)};`)
    return lines.join('\n')
  }

  return ''
}

/** 索引定义片段（按方言） */
function buildIndexDefinition(
  dialect: SqlDialect,
  schemaName: string,
  tableName: string,
  index: { name?: string; type: string; using?: string; columns: { name: string; sort_order?: 'ASC' | 'DESC'; mysql?: any; postgresql?: any; sqlite?: any }[] },
  commonConfig: CommonConfig | null,
): string {
  let indexName = index.name
  let indexType = index.type
  let indexUsing = index.using
  const override = (index as any)[dialect]
  if (override) {
    indexName = override.name || indexName
    indexType = override.type || indexType
    indexUsing = override.using || indexUsing
  }
  indexName = (indexName ?? '').replace('{pre}', indexType === 'unique' ? 'uk_' : 'idx_').replace('{post}', '') || (indexType === 'unique' ? 'uk_col' : 'idx_col')

  const colList = index.columns.map(c => {
    const { name, sortPart } = splitColumnForSql(c as any, dialect)
    return quoteIdent(dialect, name, commonConfig) + sortPart
  }).join(', ')

  const qIndexName = quoteIdent(dialect, indexName, commonConfig)
  const qTable = qualifyTable(dialect, schemaName, tableName, commonConfig)
  const keyword = indexType === 'unique' ? 'CREATE UNIQUE INDEX' : 'CREATE INDEX'


  // MySQL：USING 作为索引选项位于列列表之后
  if(dialect === 'mysql') {
    const finalIndexUsing = indexUsing ? ` USING ${indexUsing.toUpperCase()}` : ''
    return `${keyword} ${qIndexName} ON ${qTable} (${colList})${finalIndexUsing};`
  }
  // PostgreSQL：USING 子句位于列列表之前
  if (dialect === 'postgresql') {
    const using = indexUsing ? ` USING ${indexUsing.toLowerCase()}` : ''
    return `${keyword} ${qIndexName} ON ${qTable}${using} (${colList});`
  }
  // SQLite 不支持 USING 子句，索引方法由 SQLite 自行决定
  if (dialect === 'sqlite') {
    return `${keyword} ${qIndexName} ON ${qTable} (${colList});`
  }
  throw new Error(`Unsupported dialect: ${dialect}`)
}

// ===== diff → DDL =====

/**
 * 根据结构 diff 生成三方言的变更 DDL（auto_diff 部分）。
 * 需要传入「目标结构完整 schema 定义」以拿到字段/索引的完整属性。
 */
function generateDiffDdl(
  diff: StructureDiff,
  targetSchemas: import('@/types/schema').Schema[],
  commonConfig: CommonConfig | null,
): DialectLines {
  const out = emptyDialectLines()

  for (const sd of diff.schemas) {
    for (const td of sd.tables) {
      for (const dialect of DIALECTS) {
        const lines = out[dialect]
        if (td.type === 'table_added' || td.type === 'table_renamed') {
          // 新增表的完整 CREATE（复用现有生成器更稳妥，但这里仅做 ALTER 体系，新增表用简化 CREATE）
          const targetTable = findTargetTable(targetSchemas, sd.schema, td.new_name!)
          if (targetTable && td.type === 'table_added') {
            lines.push(...buildCreateTable(dialect, sd.schema, targetTable, commonConfig))
          }
          // rename 表名
          if (td.type === 'table_renamed' && td.old_name && td.new_name) {
            const qOld = qualifyTable(dialect, sd.schema, td.old_name, commonConfig)
            const qNew = quoteIdent(dialect, td.new_name, commonConfig)
            lines.push(`ALTER TABLE ${qOld} RENAME TO ${qNew};`)
          }
          // 内部字段/索引变更（rename 场景）
          for (const fd of td.fields) lines.push(...buildFieldDdl(dialect, sd.schema, td.new_name!, fd, targetSchemas))
          for (const id of td.indexes) lines.push(...buildIndexDdl(dialect, sd.schema, td.new_name!, id, targetSchemas))
        } else if (td.type === 'table_removed') {
          const qTable = qualifyTable(dialect, sd.schema, td.old_name!, commonConfig)
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
  const qTable = qualifyTable(dialect, schemaName, table.name, commonConfig)
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
    lines.push(buildIndexDefinition(dialect, schemaName, table.name, idx as any, commonConfig))
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
    if (idx) return [buildIndexDefinition(dialect, schemaName, tableName, idx as any, null)]
    return []
  }
  if (id.type === 'index_removed') {
    const idxName = id.old_name || 'idx_col'
    const qIndexName = quoteIdent(dialect, idxName, null)
    // MySQL 要求 DROP INDEX ... ON <table>
    if (dialect === 'mysql') {
      const qTable = qualifyTable(dialect, schemaName, tableName, null)
      return [`DROP INDEX ${qIndexName} ON ${qTable};`]
    }
    // SQLite 的索引名在整个数据库内唯一，DROP INDEX 不带 schema 限定
    if (dialect === 'sqlite') {
      return [`DROP INDEX ${qIndexName};`]
    }
    return [`DROP INDEX ${qualifyTable(dialect, schemaName, idxName, null)};`]
  }
  return []
}

// ===== 顶层：合并所有步骤 → 最终预览 =====

/**
 * 根据迁移脚本（steps）与目标结构生成最终合并 DDL。
 * @param migration 迁移脚本定义
 * @param diff 已计算的两个版本的结构 diff（供 auto_diff 步骤使用）
 * @param targetSchemas 目标结构完整 schema 定义
 * @param commonConfig 公共配置（用于类型解析、标识符引用）
 */
export function generateMigrationDdl(
  migration: Migration,
  diff: StructureDiff,
  targetSchemas: import('@/types/schema').Schema[],
  commonConfig: CommonConfig | null,
): MigrationDdlPreview {
  const acc = emptyDialectLines()

  for (const step of migration.steps) {
    switch (step.type) {
      case 'auto_diff': {
        const diffDdl = generateDiffDdl(diff, targetSchemas, commonConfig)
        for (const dialect of DIALECTS) {
          const lines = acc[dialect]
          if (lines.length > 0) lines.push('')
          lines.push(`-- ===== auto diff (${migration.from_version} → ${migration.to_version}) =====`)
          lines.push(...diffDdl[dialect])
        }
        break
      }
      case 'clear_column': {
        for (const dialect of DIALECTS) {
          const qTable = qualifyTable(dialect, step.schema, step.table, commonConfig)
          const lines = acc[dialect]
          lines.push(`-- clear column ${step.schema}.${step.table}.${step.column}`)
          lines.push(`UPDATE ${qTable} SET ${quoteIdent(dialect, step.column, commonConfig)} = NULL;`)
        }
        break
      }
      case 'sql_transform': {
        if (step.mysql) acc.mysql.push(fmtPrePostSql(step.mysql).trimEnd())
        if (step.postgresql) acc.postgresql.push(fmtPrePostSql(step.postgresql).trimEnd())
        if (step.sqlite) acc.sqlite.push(fmtPrePostSql(step.sqlite).trimEnd())
        break
      }
      case 'custom_sql': {
        if (step.mysql) acc.mysql.push(step.mysql)
        if (step.postgresql) acc.postgresql.push(step.postgresql)
        if (step.sqlite) acc.sqlite.push(step.sqlite)
        break
      }
    }
  }

  return {
    mysql: acc.mysql.join('\n').trimEnd() + '\n',
    postgresql: acc.postgresql.join('\n').trimEnd() + '\n',
    sqlite: acc.sqlite.join('\n').trimEnd() + '\n',
  }
}
