// 字段的数据库特定覆盖
export interface FieldOverride {
  field_type?: string
  field_length?: number | null
  default?: any
}

// 索引的数据库特定覆盖
export interface IndexOverride {
  type?: string
  name?: string
  using?: string  // 仅 mysql
}

export interface Field {
  field_name: string
  use_common_used_fields?: boolean
  field_type?: string
  field_length?: number | null
  not_null?: boolean
  primary_key?: boolean
  default?: any
  comment?: string
  is_commented_out?: boolean
  mysql?: FieldOverride
  pgsql?: FieldOverride
}

export interface Index {
  // name is optional
  name?: string
  type: string
  using?: string
  columns: string[]
  mysql?: IndexOverride
  pgsql?: Omit<IndexOverride, 'using'>
  pre_comment?: string
}

export interface TableMysqlConfig {
  mysql_engine?: string
  mysql_charset?: string
  mysql_collation?: string
}

export interface Table {
  name: string
  comment: string
  comment_before_table?: string | (string | null)[]
  comment_before_fields?: Record<string, string | (string | null)[]>
  // ↓ optional, use default_config.mysql.table if not provided
  mysql?: TableMysqlConfig
  fields: Field[]
  indexes: Index[]
}

export interface Schema {
  schema: string
  tables: Table[]
}

export interface DefaultConfig {
  mysql: {
    database: Record<string, unknown>
    table: {
      mysql_engine: string
      mysql_charset: string
      mysql_collation: string
    }
  }
}

export interface CommonConfig {
  default_config: DefaultConfig
  schema_order?: string[]
  common_used_fields: Record<string, Field>
}
