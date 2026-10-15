import type {
  CommonConfig,
  Schema,
  Table,
  Field,
  Index,
  IndexColumn,
  TableMysqlConfig,
  TablePartitionConfig,
  PartitionByConfig,
  CommentOption,
} from '@/types/schema'
import { ALL_SQL_DIALECTS } from '@/utils/sql-generator/shared'
import { stripDisabledFieldMetrics } from '@/utils/field-utils'

/** current/schemas/<schema>/schema.json：元信息与表定义分开保存。 */
export interface SchemaWriteData extends Pick<Schema, 'schema' | 'pre_sql' | 'post_sql'> {
  table_order: string[]
}

/** 根 common.json 不携带 schema_order（由 current/database.json 保存）。 */
export function buildCommonWriteData(commonConfig: CommonConfig | null): Omit<Partial<CommonConfig>, 'schema_order'> {
  const data = { ...commonConfig }
  delete data.schema_order
  const fields = data.common_used_fields
  if (fields) {
    const cleaned: Record<string, Field> = {}
    for (const key of Object.keys(fields)) {
      cleaned[key] = stripDisabledFieldMetrics(fields[key]!)
    }
    data.common_used_fields = cleaned
  }
  return data
}

function buildSchemaSqlData(schema: Schema): Pick<Schema, 'pre_sql' | 'post_sql'> {
  const data: Pick<Schema, 'pre_sql' | 'post_sql'> = {}
  if (schema.pre_sql && Object.keys(schema.pre_sql).length > 0) {
    data.pre_sql = { ...schema.pre_sql }
  }
  if (schema.post_sql && Object.keys(schema.post_sql).length > 0) {
    data.post_sql = { ...schema.post_sql }
  }
  return data
}

/** 新布局的 schema 元信息；保留非空 SQL 配置，不嵌入 tables。 */
export function buildSchemaWriteData(schema: Schema): SchemaWriteData {
  return {
    schema: schema.schema,
    table_order: schema.tables.map(table => table.name),
    ...buildSchemaSqlData(schema),
  }
}

/** 完整 schema 导出（含表定义），兼容现有 CRUD API。 */
export function buildSchemaExportData(schema: Schema): Schema {
  return {
    schema: schema.schema,
    tables: schema.tables.map(buildTableExportData),
    ...buildSchemaSqlData(schema),
  }
}

/** 将单表内存态转换为可写出的 table.json 对象，不修改入参。 */
export function buildTableExportData(table: Table): Table {
  const tableData: Partial<Table> = {
    name: table.name,
    comment: table.comment,
  }
  // comment_before_table
  if (table.comment_before_table) {
    tableData.comment_before_table = table.comment_before_table
  }

  // comment_before_fields
  if (table.comment_before_fields && Object.keys(table.comment_before_fields).length > 0) {
    tableData.comment_before_fields = {}
    for (const [k, v] of Object.entries(table.comment_before_fields)) {
      tableData.comment_before_fields[k] = v
    }
  }

  // pre_sql / post_sql
  if (table.pre_sql && Object.keys(table.pre_sql).length > 0) {
    tableData.pre_sql = { ...table.pre_sql }
  }
  if (table.post_sql && Object.keys(table.post_sql).length > 0) {
    tableData.post_sql = { ...table.post_sql }
  }

  // mysql table config
  if (table.mysql && Object.keys(table.mysql).length > 0) {
    const mysqlData: TableMysqlConfig = {}
    if (table.mysql.mysql_engine) mysqlData.mysql_engine = table.mysql.mysql_engine
    if (table.mysql.mysql_charset) mysqlData.mysql_charset = table.mysql.mysql_charset
    if (table.mysql.mysql_collation) mysqlData.mysql_collation = table.mysql.mysql_collation
    if (Object.keys(mysqlData).length > 0) tableData.mysql = mysqlData
  }

  // partition（按方言配置，空时不写出）
  if (table.partition && Object.keys(table.partition).length > 0) {
    const resolved: TablePartitionConfig = {}
    for (const dialect of ALL_SQL_DIALECTS) {
      const cfg = table.partition[dialect]
      if (cfg && Object.keys(cfg).length > 0) {
        const next: PartitionByConfig = {}
        if (cfg.strategy) next.strategy = cfg.strategy
        if (cfg.columns && cfg.columns.length > 0) next.columns = [...cfg.columns]
        if (cfg.expression) next.expression = cfg.expression
        if (Object.keys(next).length > 0) resolved[dialect] = next
      }
    }
    if (Object.keys(resolved).length > 0) tableData.partition = resolved
  }

  // fields
  tableData.fields = table.fields.map(field => {
    const f: Field = { field_name: field.field_name }
    if (field.use_common_used_fields) {
      f.use_common_used_fields = true
    } else {
      // 导出 unified_type（仅当有值时）
      if (field.unified_type) {
        f.unified_type = field.unified_type
        // 有 unified_type 时不导出冗余的 field_type/field_length/field_scale（除非有显式字段级覆盖）
        if (field.field_type !== undefined && field.field_type !== '') f.field_type = field.field_type
        if (field.field_length !== undefined) f.field_length = field.field_length
        if (field.field_scale !== undefined) f.field_scale = field.field_scale
      } else {
        if (field.field_type !== undefined) f.field_type = field.field_type
        if (field.field_length !== undefined) f.field_length = field.field_length
        if (field.field_scale !== undefined) f.field_scale = field.field_scale
      }
      if (field.not_null !== undefined) f.not_null = field.not_null
      // primary_key：仅当为 true 时写出（false/undefined 视为默认，省略该属性，精简 JSON）
      if (field.primary_key === true) f.primary_key = true
      if (field.default !== undefined) f.default = field.default
      // 保留显式的 false / 0 / null，避免丢失 ON UPDATE 配置或精度 0。
      if (field.on_update_current_timestamp !== undefined) f.on_update_current_timestamp = field.on_update_current_timestamp
      if (field.on_update_current_timestamp_precision !== undefined) f.on_update_current_timestamp_precision = field.on_update_current_timestamp_precision
      // 仅自定义类型字段导出 quote_default（统一类型字段从类型定义中获取）
      if (!field.unified_type && field.quote_default !== undefined) f.quote_default = field.quote_default
      if (field.comment !== undefined) f.comment = field.comment
      if (field.comment_options_enabled) f.comment_options_enabled = true
      if (field.comment_options && field.comment_options.length > 0) {
        f.comment_options = field.comment_options.map(o => {
          const co: CommentOption = { label: o.label ?? '', value: o.value ?? '' }
          if (o.mysql !== undefined && o.mysql !== '') co.mysql = o.mysql
          if (o.postgresql !== undefined && o.postgresql !== '') co.postgresql = o.postgresql
          if (o.sqlite !== undefined && o.sqlite !== '') co.sqlite = o.sqlite
          return co
        })
      }
      if (field.is_commented_out) f.is_commented_out = true
      if (field.field_length_disabled) f.field_length_disabled = true
      if (field.field_scale_disabled) f.field_scale_disabled = true
      // db overrides
      if (field.mysql && Object.keys(field.mysql).length > 0) f.mysql = { ...field.mysql }
      if (field.postgresql && Object.keys(field.postgresql).length > 0) f.postgresql = { ...field.postgresql }
      if (field.sqlite && Object.keys(field.sqlite).length > 0) f.sqlite = { ...field.sqlite }
    }
    // 已禁用长度/小数位时不再输出对应数值（disabled 已完全决定输出，保留数值只会误导）
    return stripDisabledFieldMetrics(f)
  })

  // indexes
  tableData.indexes = table.indexes.map(index => {
    const idx: Partial<Index> = {}
    // 使用默认索引名时不再导出 name（该名字不参与 SQL 生成，避免留下误导性的冗余字段）
    if (index.use_default_name) {
      idx.use_default_name = true
    } else if (index.name) {
      idx.name = index.name
    }
    if (index.type) idx.type = index.type
    if (index.using) idx.using = index.using
    // 逻辑删除感知：仅约束未删除行 + 索引级覆盖（逐键覆盖项目级配置）
    if (index.active_only) idx.active_only = true
    if (index.logical_delete && Object.keys(index.logical_delete).length > 0) {
      idx.logical_delete = { ...index.logical_delete }
    }
    idx.columns = index.columns.map(c => {
      const col: IndexColumn = { name: c.name }
      if (c.sort_order) col.sort_order = c.sort_order
      if (c.mysql && Object.keys(c.mysql).length > 0) col.mysql = { ...c.mysql }
      if (c.postgresql && Object.keys(c.postgresql).length > 0) col.postgresql = { ...c.postgresql }
      if (c.sqlite && Object.keys(c.sqlite).length > 0) col.sqlite = { ...c.sqlite }
      return col
    })
    if (index.comment) idx.comment = index.comment
    if (index.pre_comment) idx.pre_comment = index.pre_comment
    if (index.mysql && Object.keys(index.mysql).length > 0) idx.mysql = { ...index.mysql }
    if (index.postgresql && Object.keys(index.postgresql).length > 0) idx.postgresql = { ...index.postgresql }
    if (index.sqlite && Object.keys(index.sqlite).length > 0) idx.sqlite = { ...index.sqlite }
    return idx as Index
  })

  return tableData as Table
}
