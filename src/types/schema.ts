/** 前置/后置 SQL 语句（按方言分别配置） */
export interface SqlStatements {
  mysql?: string
  postgresql?: string
}

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
  postgresql: UnifiedTypeDbMapping
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
  postgresql?: IndexColumnDbOverride
}

export interface Field {
  field_name: string
  /** 字段唯一 id（创建首个版本时延迟生成，用于跨版本变更识别 rename） */
  field_id?: string
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
  postgresql?: FieldOverride
}

export interface Index {
  // name is optional
  name?: string
  /** 索引唯一 id（创建时即生成，用于跨版本变更识别） */
  index_id?: string
  type: string
  using?: string
  columns: IndexColumn[]
  comment?: string
  mysql?: IndexOverride
  postgresql?: Omit<IndexOverride, 'using'>
  pre_comment?: string
}

export interface TableMysqlConfig {
  mysql_engine?: string
  mysql_charset?: string
  mysql_collation?: string
}

/**
 * 单方言的分区表配置（PARTITION BY）。
 * 采用「结构化策略 + 列」为主、原始表达式兜底的设计：
 * - 设置 `strategy` + `columns` → 生成 `PARTITION BY <strategy> (col1, col2)`
 * - 仅设置 `expression` → 直接生成 `PARTITION BY <expression>`（覆盖所有方言差异，
 *   例如 MySQL 的 `RANGE COLUMNS` / `KEY (...)` 或 PostgreSQL 的 `RANGE (to_days(...))` 等）
 */
export interface PartitionByConfig {
  /** 分区策略，如 RANGE / LIST / HASH / KEY（MySQL）/ RANGE COLUMNS（MySQL）等 */
  strategy?: string
  /** 分区键列名（结构化模式时使用） */
  columns?: string[]
  /** 原始分区表达式（兜底模式，生成 `PARTITION BY <expression>`） */
  expression?: string
}

/** 表级分区配置，按方言分别配置（与 Field/Index 的 mysql?/postgresql? 覆盖模式一致） */
export interface TablePartitionConfig {
  mysql?: PartitionByConfig
  postgresql?: PartitionByConfig
}

export interface Table {
  name: string
  /** 表唯一 id（创建首个版本时延迟生成，用于跨版本变更识别 rename） */
  table_id?: string
  comment: string
  comment_before_table?: string | (string | null)[]
  comment_before_fields?: Record<string, string | (string | null)[]>
  // ↓ optional, use default_config.mysql.table if not provided
  mysql?: TableMysqlConfig
  /** 分区表配置（按方言分别配置 PARTITION BY），为空时不生成分区子句 */
  partition?: TablePartitionConfig
  fields: Field[]
  indexes: Index[]
  /** 前置 SQL（按方言分别配置，生成在 CREATE TABLE 和 INSERT 之前） */
  pre_sql?: SqlStatements
  /** 后置 SQL（按方言分别配置，生成在 CREATE TABLE 和 INSERT 之后） */
  post_sql?: SqlStatements
}

export interface Schema {
  schema: string
  /** schema 唯一 id（创建首个版本时延迟生成） */
  schema_id?: string
  tables: Table[]
  /** 前置 SQL（按方言分别配置，生成在所有表之前） */
  pre_sql?: SqlStatements
  /** 后置 SQL（按方言分别配置，生成在所有表之后） */
  post_sql?: SqlStatements
}

export type TableDdlMode = 'create' | 'drop_and_create' | 'create_if_not_exists'

export interface DefaultConfig {
  /** DDL 生成策略：create=纯CREATE TABLE, drop_and_create=DROP+CREATE, create_if_not_exists=CREATE IF NOT EXISTS */
  table_ddl_mode?: TableDdlMode
  mysql: {
    database: Record<string, unknown>
    table: {
      mysql_engine: string
      mysql_charset: string
      mysql_collation: string
    }
    /** 全局前置 SQL（MySQL 方言） */
    pre_sql?: string
    /** 全局后置 SQL（MySQL 方言） */
    post_sql?: string
  }
  postgresql: {
    quote_identifiers: boolean
    /** 全局前置 SQL（PostgreSQL 方言） */
    pre_sql?: string
    /** 全局后置 SQL（PostgreSQL 方言） */
    post_sql?: string
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
  /** 是否在当前项目文件夹中生成 AI JSON 结构指南（AI_JSON_STRUCTURE_GUIDE.md）；缺省视为 true */
  generate_ai_guide?: boolean
}

/**
 * 单行初始数据（行内结构）。
 * 行数据与其注释/跳过标记内聚在同一对象，根除旧「平行数组靠索引对齐」的脆弱性。
 */
export interface InitialDataRow {
  /** 行的字段数据 */
  data: Record<string, any>
  /** 初始数据行唯一 id（创建时即生成，用于跨版本变更识别） */
  initial_data_id?: string
  /** 该行的字段级注释（仅有注释的字段才出现） */
  field_comments?: Record<string, string>
  /** 是否跳过该行（true 时该行不生成 INSERT 语句，语义同旧 skip_rows[i]===true） */
  is_skip?: boolean
  /** 行级注释（可选） */
  row_comment?: string
}

export interface InitialData {
  /** 行内化的数据行；未初始化数据板块时为 undefined，空表为 [] */
  rows?: InitialDataRow[]
  /** 前置 SQL（按方言分别配置，生成在 INSERT 之前） */
  pre_sql?: SqlStatements
  /** 后置 SQL（按方言分别配置，生成在 INSERT 之后） */
  post_sql?: SqlStatements
}

/**
 * 旧版初始数据结构（四个平行数组，靠索引对齐）。
 * 仅用于升级器读取旧磁盘格式，运行时内存态一律使用 {@link InitialData} 行内结构。
 */
export interface LegacyInitialData {
  rows?: Record<string, any>[]
  row_comments?: (string | null)[]
  field_comments?: (Record<string, string> | null)[]
  /** 逐行跳过标记：skip_rows[i] === true 时该行不生成 INSERT 语句 */
  skip_rows?: (boolean | null)[]
  /** 前置 SQL（按方言分别配置，生成在 INSERT 之前） */
  pre_sql?: SqlStatements
  /** 后置 SQL（按方言分别配置，生成在 INSERT 之后） */
  post_sql?: SqlStatements
}
