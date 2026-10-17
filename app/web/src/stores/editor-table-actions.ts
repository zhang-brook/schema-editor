import type { PartitionByConfig, Schema, SqlStatements, Table } from 'schema-editor-core/types/schema'
import type { SqlDialect } from 'schema-editor-core/utils/sql-generator/shared'
import { affectedSchema, affectedSql } from 'schema-editor-core/core/history/command'
import { getDialectSubConfig } from 'schema-editor-core/utils/dialect-resolver'
import { cloneValue, type ActionContext } from './editor-action-utils'
import type { CrudDeps } from './editor-crud'

export function createTableActions(deps: CrudDeps, ctx: ActionContext) {
  const { t } = deps
  type TablePatch = Partial<Omit<Table, 'name' | 'fields' | 'indexes'>>
  function updateTable(table: Table, changes: TablePatch, key?: string) {
    ctx.patch(table, changes, t('history.editCommentBeforeTable'), () => ctx.tableFiles(table), `table:${ctx.objectKey(table)}:${key ?? Object.keys(changes).sort().join(',')}`)
  }
  function commentText(value: string | (string | null)[] | undefined) {
    return Array.isArray(value) ? value.map(line => line ?? '').join('\n') : value ?? ''
  }
  function commentValue(text: string): string | (string | null)[] | undefined {
    const lines = text.split('\n')
    return lines.length === 1 ? (text || undefined) : lines.map(line => line || null)
  }
  function commentBeforeTableText(table: Table) { return commentText(table.comment_before_table) }
  function setCommentBeforeTable(table: Table, text: string) {
    updateTable(table, { comment_before_table: commentValue(text) })
  }
  function commentBeforeFieldText(table: Table, name: string) { return commentText(table.comment_before_fields?.[name]) }
  function setCommentBeforeField(table: Table, name: string, text: string) {
    const next = cloneValue(table.comment_before_fields ?? {})
    if (text.trim()) next[name] = commentValue(text)!
    else delete next[name]
    const field = table.fields.find(f => f.field_name === name)
    ctx.patch(table, { comment_before_fields: Object.keys(next).length ? next : undefined }, t('history.editCommentBeforeField', { name }), () => ctx.tableFiles(table), `field-before:${ctx.objectKey(table)}:${field ? ctx.identity(field) : name}`)
  }
  function getTableMysqlEngine(table: Table) { return getDialectSubConfig(table.mysql, 'mysql_engine', '') }
  function getTableMysqlCharset(table: Table) { return getDialectSubConfig(table.mysql, 'mysql_charset', '') }
  function getTableMysqlCollation(table: Table) { return getDialectSubConfig(table.mysql, 'mysql_collation', '') }
  function setMysql(table: Table, key: keyof NonNullable<Table['mysql']>, value: string, label: string) {
    const mysql = { ...table.mysql }
    if (value) mysql[key] = value
    else delete mysql[key]
    ctx.patch(table, { mysql: Object.values(mysql).some(v => v !== undefined && v !== '') ? mysql : undefined }, t(label), () => ctx.tableFiles(table), `mysql:${ctx.objectKey(table)}:${key}`)
  }
  function setTableMysqlEngine(table: Table, value: string) { setMysql(table, 'mysql_engine', value, 'history.editTableMysqlEngine') }
  function setTableMysqlCharset(table: Table, value: string) { setMysql(table, 'mysql_charset', value, 'history.editTableMysqlCharset') }
  function setTableMysqlCollation(table: Table, value: string) { setMysql(table, 'mysql_collation', value, 'history.editTableMysqlCollation') }

  function getTablePartition(table: Table, dialect: SqlDialect): PartitionByConfig {
    const cfg = table.partition?.[dialect]
    return { strategy: cfg?.strategy || '', columns: [...(cfg?.columns ?? [])], expression: cfg?.expression || '' }
  }
  function setTablePartition(table: Table, dialect: SqlDialect, value: PartitionByConfig) {
    const partition = cloneValue(table.partition ?? {})
    const next: PartitionByConfig = {}
    if (value.strategy) next.strategy = value.strategy
    if (value.columns?.length) next.columns = [...value.columns]
    if (value.expression) next.expression = value.expression
    if (Object.keys(next).length) partition[dialect] = next
    else delete partition[dialect]
    ctx.patch(table, { partition: Object.keys(partition).length ? partition : undefined }, t('history.editTablePartition', { dialect }), () => ctx.tableFiles(table), `partition:${ctx.objectKey(table)}:${dialect}`)
  }

  function sqlPatch(target: Table | Schema, prop: 'pre_sql' | 'post_sql', dialect: SqlDialect, value: string) {
    const next: SqlStatements = { ...target[prop] }
    const trimmed = value.trim()
    if (trimmed) next[dialect] = trimmed
    else delete next[dialect]
    const isTable = 'fields' in target
    const label = `history.edit${isTable ? 'Table' : 'Schema'}${prop === 'pre_sql' ? 'PreSql' : 'PostSql'}`
    ctx.patch(target, { [prop]: Object.keys(next).length ? next : undefined }, t(label, { dialect }),
      () => isTable ? ctx.tableFiles(target) : [affectedSchema(target.schema), affectedSql()],
      `sql:${ctx.identity(target)}:${prop}:${dialect}`)
  }
  function setTablePreSql(table: Table, db: SqlDialect, value: string) { sqlPatch(table, 'pre_sql', db, value) }
  function setTablePostSql(table: Table, db: SqlDialect, value: string) { sqlPatch(table, 'post_sql', db, value) }
  function setSchemaPreSql(schema: Schema, db: SqlDialect, value: string) { sqlPatch(schema, 'pre_sql', db, value) }
  function setSchemaPostSql(schema: Schema, db: SqlDialect, value: string) { sqlPatch(schema, 'post_sql', db, value) }

  return { updateTable, commentBeforeTableText, setCommentBeforeTable, commentBeforeFieldText, setCommentBeforeField, getTableMysqlEngine, getTableMysqlCharset, getTableMysqlCollation, setTableMysqlEngine, setTableMysqlCharset, setTableMysqlCollation, getTablePartition, setTablePartition, setTablePreSql, setTablePostSql, setSchemaPreSql, setSchemaPostSql }
}
