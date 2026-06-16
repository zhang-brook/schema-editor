/** 字段类型大小写转换模式 */
export type TypeCaseMode = 'keep' | 'lowercase' | 'uppercase' | 'pascal'

/** 默认值输入组件类型 */
export type DefaultInputType = 'text' | 'boolean'

// 统一顶层类型 — 数据库方言映射
export interface UnifiedTypeDbMapping {
  type: string
  length?: number | null
  scale?: number | null
}

export interface UnifiedTypeDefinition {
  name: string
  description?: string
  /** 默认值是否需要引号包裹（字符串类型=true，数字/bool类型=false） */
  quote_default?: boolean
  /** 默认值的输入组件类型（text=文本输入框, boolean=TRUE/FALSE下拉框），省略默认为 text */
  default_input?: DefaultInputType
  mysql: UnifiedTypeDbMapping
  pgsql: UnifiedTypeDbMapping
}

// 字段的数据库特定覆盖
export interface FieldOverride {
  field_type?: string
  field_length?: number | null
  field_scale?: number | null
  default?: any
}

// 索引的数据库特定覆盖
export interface IndexOverride {
  type?: string
  name?: string
  using?: string  // 仅 mysql
}

// 索引列的数据库特定覆盖（排序方向）
export interface IndexColumnDbOverride {
  sort_order?: 'ASC' | 'DESC'
}

// 索引列（结构化对象，替代旧版纯字符串）
export interface IndexColumn {
  name: string
  sort_order?: 'ASC' | 'DESC'
  mysql?: IndexColumnDbOverride
  pgsql?: IndexColumnDbOverride
}

export interface Field {
  field_name: string
  use_common_used_fields?: boolean
  /** 指向 CommonConfig.unified_types 中的类型名，为空时回退到 field_type 自由文本 */
  unified_type?: string
  field_type?: string
  field_length?: number | null
  field_scale?: number | null
  /** 勾选后强制跳过长度输出，SQL 中不生成 (N) 部分 */
  field_length_disabled?: boolean
  /** 勾选后强制跳过小数位输出 */
  field_scale_disabled?: boolean
  not_null?: boolean
  primary_key?: boolean
  /** 默认值是否需要引号包裹（覆盖 unified_type 的设置，仅自定义类型时生效） */
  quote_default?: boolean
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
  columns: IndexColumn[]
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
  pgsql: {
    quote_identifiers: boolean
  }
}

export interface CommonConfig {
  struct_version?: string  // 结构版本号，缺省为 "0.0"
  default_config: DefaultConfig
  schema_order?: string[]
  common_used_fields: Record<string, Field>
  /** 维护 common_used_fields 的显示顺序（绕过 JS 对象对纯数字键的自动排序） */
  common_used_field_order?: string[]
  /** 统一顶层类型定义 — 每个顶层类型映射到各数据库方言的具体类型 */
  unified_types?: UnifiedTypeDefinition[]
  /** 字段类型大小写：keep=保持原样, lowercase=全小写, uppercase=全大写, pascal=大驼峰 */
  type_case?: TypeCaseMode
}

export interface InitialData {
  rows: Record<string, any>[]
  row_comments?: (string | null)[]
  field_comments?: (Record<string, string> | null)[]
}
