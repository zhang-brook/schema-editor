/**
 * Migration script → change DDL generator (MySQL + PostgreSQL + SQLite dialects).
 *
 * Input: structure diff (auto_diff step) + clear_column / sql_transform / custom_sql steps.
 * Output: merged final change SQL (per dialect).
 *
 * Reuses the field resolution primitives from sql-generator/shared; only ALTER TABLE
 * fragment construction is added, leaving the existing full DDL generator untouched.
 *
 * SQLite has limited ALTER support (only ADD COLUMN / DROP COLUMN / RENAME COLUMN / RENAME TO,
 * with no schema prefix and no USING clause), so changing column attributes requires a table
 * rebuild; advisory comments are emitted here instead.
 */
import type { CommonConfig, Field, Index, IndexOverride, Table } from '../../types/schema'
import type { SqlDialect } from '../../utils/sql-generator/shared'
import {
  resolveFieldTypeForDialect,
  resolveQuoteDefault,
  formatSqlDefault,
} from '../../utils/sql-generator/shared'
import { splitColumnForSql } from '../../utils/index-column-utils'
import { resolveDialectOverride } from '../../utils/dialect-resolver'
import { buildMysqlActiveExpression, resolveIndexLogicalDelete } from '../../utils/logical-delete'
import { fmtPrePostSql } from '../../utils/sql-generator/shared'
import type {
  FieldDiff,
  IndexDiff,
  Migration,
  MigrationDdlPreview,
  StructureDiff,
} from './types'

const DIALECTS: SqlDialect[] = ['mysql', 'postgresql', 'sqlite']

/** Identifier quoting (per dialect) */
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
 * Table name qualification (per dialect).
 * SQLite has no schema concept (a schema maps to a database file), so no schema prefix is added.
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

/** Container accumulating DDL fragments per dialect */
type DialectLines = Record<SqlDialect, string[]>

function emptyDialectLines(): DialectLines {
  return {
    mysql: [],
    postgresql: [],
    sqlite: [],
  }
}

/** Build a single field definition fragment (for ADD COLUMN), returning a prefix-free fragment such as `name VARCHAR(255) NOT NULL` */
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

  // ON UPDATE CURRENT_TIMESTAMP[(n)] (MySQL only)
  if (dialect === 'mysql' && field.on_update_current_timestamp) {
    const precision = field.on_update_current_timestamp_precision
    def += typeof precision === 'number'
      ? ` ON UPDATE CURRENT_TIMESTAMP(${precision})`
      : ' ON UPDATE CURRENT_TIMESTAMP'
  }

  if (dialect === 'mysql' && field.comment) {
    def += ` COMMENT '${field.comment.replace(/'/g, "''")}'`
  }
  void tableName
  return def
}

/** Build the full ALTER ADD for a single field (including COMMENT ON, PG style) */
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
  // MySQL 8 / PostgreSQL / SQLite(3.25+) all use RENAME COLUMN
  return `ALTER TABLE ${qTable} RENAME COLUMN ${qOld} TO ${qNew};`
}

/** Modify field attributes (type/length/default/nullability/comment, etc.) */
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
    // PostgreSQL: types and constraints are handled separately
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
    // SQLite's ALTER TABLE cannot modify column attributes; only "create new table → copy data → rename → drop old table" works
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

/** Index definition fragment (per dialect) */
function buildIndexDefinition(
  dialect: SqlDialect,
  schemaName: string,
  tableName: string,
  table: Table,
  index: Index,
  commonConfig: CommonConfig | null,
): string {
  let indexName = index.name
  let indexType = index.type
  let indexUsing = index.using
  const override = index[dialect] as IndexOverride | undefined
  if (override) {
    indexName = override.name || indexName
    indexType = override.type || indexType
    indexUsing = override.using || indexUsing
  }
  indexName = (indexName ?? '').replace('{pre}', indexType === 'unique' ? 'uk_' : 'idx_').replace('{post}', '') || (indexType === 'unique' ? 'uk_col' : 'idx_col')

  // Logical-delete awareness: MySQL uses functional indexes / folds the delete column into the index columns; PostgreSQL / SQLite use partial indexes
  const logicalDelete = resolveIndexLogicalDelete(index, table, dialect, commonConfig)
  const useMysqlExpression = dialect === 'mysql' && logicalDelete?.mysqlStrategy === 'functional'
  const appendDeleteColumn =
    dialect === 'mysql' &&
    logicalDelete?.mysqlStrategy === 'timestamp_union' &&
    !index.columns.some(c => c.name === logicalDelete.field)
  const columnsForSql = appendDeleteColumn && logicalDelete
    ? [...index.columns, { name: logicalDelete.field }]
    : index.columns

  const colList = columnsForSql.map(c => {
    const { name, sortPart } = splitColumnForSql(c, dialect)
    if (useMysqlExpression && logicalDelete) {
      return `(${buildMysqlActiveExpression(name, logicalDelete.field)})${sortPart}`
    }
    return quoteIdent(dialect, name, commonConfig) + sortPart
  }).join(', ')

  // MySQL has no partial index syntax; the other dialects append WHERE after the index definition
  const whereClause = logicalDelete && dialect !== 'mysql' ? ` WHERE ${logicalDelete.predicate}` : ''

  const qIndexName = quoteIdent(dialect, indexName, commonConfig)
  const qTable = qualifyTable(dialect, schemaName, tableName, commonConfig)
  const keyword = indexType === 'unique' ? 'CREATE UNIQUE INDEX' : 'CREATE INDEX'


  // MySQL: USING is an index option placed after the column list
  if(dialect === 'mysql') {
    const finalIndexUsing = indexUsing ? ` USING ${indexUsing.toUpperCase()}` : ''
    return `${keyword} ${qIndexName} ON ${qTable} (${colList})${finalIndexUsing};`
  }
  // PostgreSQL: the USING clause comes before the column list
  if (dialect === 'postgresql') {
    const using = indexUsing ? ` USING ${indexUsing.toLowerCase()}` : ''
    return `${keyword} ${qIndexName} ON ${qTable}${using} (${colList})${whereClause};`
  }
  // SQLite does not support the USING clause; the index method is left to SQLite
  if (dialect === 'sqlite') {
    return `${keyword} ${qIndexName} ON ${qTable} (${colList})${whereClause};`
  }
  throw new Error(`Unsupported dialect: ${dialect}`)
}

// ===== diff → DDL =====

/**
 * Generate change DDL for all three dialects from the structure diff (auto_diff part).
 * Requires the full target schema definition to obtain complete field/index attributes.
 */
function generateDiffDdl(
  diff: StructureDiff,
  targetSchemas: import('../../types/schema').Schema[],
  commonConfig: CommonConfig | null,
): DialectLines {
  const out = emptyDialectLines()

  for (const sd of diff.schemas) {
    for (const td of sd.tables) {
      for (const dialect of DIALECTS) {
        const lines = out[dialect]
        if (td.type === 'table_added' || td.type === 'table_renamed') {
          // Full CREATE for added tables (reusing the existing generator is safer, but this only covers the ALTER system, so added tables use a simplified CREATE)
          const targetTable = findTargetTable(targetSchemas, sd.schema, td.new_name!)
          if (targetTable && td.type === 'table_added') {
            lines.push(...buildCreateTable(dialect, sd.schema, targetTable, commonConfig))
          }
          // rename table name
          if (td.type === 'table_renamed' && td.old_name && td.new_name) {
            const qOld = qualifyTable(dialect, sd.schema, td.old_name, commonConfig)
            const qNew = quoteIdent(dialect, td.new_name, commonConfig)
            lines.push(`ALTER TABLE ${qOld} RENAME TO ${qNew};`)
          }
          // Inner field/index changes (rename case)
          for (const fd of td.fields) lines.push(...buildFieldDdl(dialect, sd.schema, td.new_name!, fd, targetSchemas))
          for (const id of td.indexes) lines.push(...buildIndexDdl(dialect, sd.schema, td.new_name!, id, targetSchemas, commonConfig))
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
  schemas: import('../../types/schema').Schema[],
  schemaName: string,
  tableName: string,
): import('../../types/schema').Table | undefined {
  const s = schemas.find(x => x.schema === schemaName)
  return s?.tables.find(t => t.name === tableName)
}

function buildCreateTable(
  dialect: SqlDialect,
  schemaName: string,
  table: import('../../types/schema').Table,
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
    lines.push(buildIndexDefinition(dialect, schemaName, table.name, table, idx, commonConfig))
  }
  return lines
}

function buildFieldDdl(
  dialect: SqlDialect,
  schemaName: string,
  tableName: string,
  fd: FieldDiff,
  targetSchemas: import('../../types/schema').Schema[],
): string[] {
  const targetTable = findTargetTable(targetSchemas, schemaName, tableName)
  if (!targetTable) return []
  switch (fd.type) {
    case 'field_added': {
      const f = targetTable.fields.find(x => x.field_name === fd.new_name)
      if (f) return [buildAddColumn(dialect, schemaName, tableName, f, null)]
      return []
    }
    case 'field_removed':
      return [buildDropColumn(dialect, schemaName, tableName, fd.old_name!, null)]
    case 'field_renamed':
      return [buildRenameColumn(dialect, schemaName, tableName, fd.old_name!, fd.new_name!, null)]
    case 'field_modified': {
      const f = targetTable.fields.find(x => x.field_name === fd.new_name)
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
  targetSchemas: import('../../types/schema').Schema[],
  commonConfig: CommonConfig | null,
): string[] {
  const targetTable = findTargetTable(targetSchemas, schemaName, tableName)
  if (!targetTable) return []
  if (id.type === 'index_added' || id.type === 'index_modified') {
    const idx = targetTable.indexes.find(x => x.name === id.new_name)
    if (idx) return [buildIndexDefinition(dialect, schemaName, tableName, targetTable, idx, commonConfig)]
    return []
  }
  if (id.type === 'index_removed') {
    const idxName = id.old_name || 'idx_col'
    const qIndexName = quoteIdent(dialect, idxName, null)
    // MySQL requires DROP INDEX ... ON <table>
    if (dialect === 'mysql') {
      const qTable = qualifyTable(dialect, schemaName, tableName, null)
      return [`DROP INDEX ${qIndexName} ON ${qTable};`]
    }
    // SQLite index names are unique across the whole database, so DROP INDEX takes no schema qualifier
    if (dialect === 'sqlite') {
      return [`DROP INDEX ${qIndexName};`]
    }
    return [`DROP INDEX ${qualifyTable(dialect, schemaName, idxName, null)};`]
  }
  return []
}

// ===== Top level: merge all steps → final preview =====

/**
 * Generate the final merged DDL from the migration script (steps) and the target structure.
 * @param migration Migration script definition
 * @param diff Structure diff between the two versions, already computed (used by the auto_diff step)
 * @param targetSchemas Full schema definition of the target structure
 * @param commonConfig Common config (for type resolution and identifier quoting)
 */
export function generateMigrationDdl(
  migration: Migration,
  diff: StructureDiff,
  targetSchemas: import('../../types/schema').Schema[],
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
