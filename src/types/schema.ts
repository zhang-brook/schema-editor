import type { SqlDialect } from '@/utils/sql-generator/shared'

/** 前置/后置 SQL 语句（按方言分别配置） */
export interface SqlStatements {
  mysql?: string
  postgresql?: string
  sqlite?: string
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
  /**
   * SQLite 方言映射。
   * 可选：旧版本 common.json 中的 unified_types 不含该键，缺失时按「不限制类型」处理
   * （回退到字段级 field_type），故解析链必须容忍 undefined。
   */
  sqlite?: UnifiedTypeDbMapping
}

/**
 * 字段注释选项含义配置项。
 * 用于在字段注释后自动拼接「值-含义」枚举（如 0-不启用，1-启用，默认1）。
 * value 为通用值；mysql/postgresql/sqlite 为可选的方言覆盖值（省略时回退 value）。
 */
export interface CommentOption {
  /** 选项含义标签（如「启用」） */
  label: string
  /** 通用值（各方言默认取此值） */
  value: string
  /** MySQL 方言覆盖值（省略则用 value） */
  mysql?: string
  /** PostgreSQL 方言覆盖值（省略则用 value） */
  postgresql?: string
  /** SQLite 方言覆盖值（省略则用 value） */
  sqlite?: string
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

/** MySQL 逻辑删除感知唯一索引的落地策略 */
export type LogicalDeleteMysqlStrategy = 'functional' | 'timestamp_union'

/**
 * 逻辑删除配置：声明哪个字段是逻辑删除标记，以及唯一索引如何绕开「已删除行仍占用唯一性」的问题。
 *
 * 两个层级：
 * - 项目级：`CommonConfig.logical_delete`（全局默认）
 * - 索引级：`Index.logical_delete`（覆盖项目级同名键，缺省回退项目级）
 */
export interface LogicalDeleteConfig {
  /** 是否启用逻辑删除感知；未启用时索引上的 active_only 不产生任何效果 */
  enabled?: boolean
  /** 逻辑删除字段名；表中不存在该字段时，该表的索引降级为普通唯一索引 */
  field?: string
  /**
   * 「未删除」判定谓词（不完整 WHERE 条件，不含 WHERE 关键字）。
   * 缺省由 field 推导：字段名含 delete/del（或为时间戳语义）→ `<field> IS NULL`，否则 → `<field> = 0`。
   */
  predicate?: string
  /**
   * MySQL 落地策略（MySQL 不支持部分索引，只能绕）：
   * - `functional`：函数索引 `((IF(<field> IS NULL, col, NULL)))`，需 MySQL 8.0.13+
   * - `timestamp_union`：把逻辑删除列并入索引列，要求该列每次删除写入不同值（时间戳 / 主键），兼容 5.7
   */
  mysql_strategy?: LogicalDeleteMysqlStrategy
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
  sqlite?: IndexColumnDbOverride
}

export interface Field {
  field_name: string
  use_common_used_fields?: boolean
  /** 指向 CommonConfig.unified_types 中的类型名，为空时回退到 field_type 自由文本 */
  unified_type?: string
  field_type?: string
  field_length?: number | null
  field_scale?: number | null
  /** 勾选后强制跳过长度输出，SQL 中不生成 (N) 部分；落盘时会自动移除无意义的 field_length */
  field_length_disabled?: boolean
  /** 勾选后强制跳过小数位输出；落盘时会自动移除无意义的 field_scale */
  field_scale_disabled?: boolean
  not_null?: boolean
  primary_key?: boolean
  /** 默认值是否需要引号包裹（覆盖 unified_type 的设置，仅自定义类型时生效） */
  quote_default?: boolean
  default?: any
  comment?: string
  /** 勾选后在注释后自动拼接选项含义（依据 comment_options 生成，随方言变化） */
  comment_options_enabled?: boolean
  /** 注释选项含义配置项列表 */
  comment_options?: CommentOption[]
  is_commented_out?: boolean
  mysql?: FieldOverride
  postgresql?: FieldOverride
  sqlite?: FieldOverride
}

export interface Index {
  // name is optional
  name?: string
  /** 勾选后不指定索引名：MySQL 省略索引名由数据库自动命名，PostgreSQL / SQLite 回退「前缀 + 列名拼接」 */
  use_default_name?: boolean
  type: string
  using?: string
  columns: IndexColumn[]
  /**
   * 唯一索引仅约束「未删除」行（逻辑删除感知），规避软删除与唯一索引的冲突。
   * 仅对 unique 索引生效；具体字段名 / 策略取自 Index.logical_delete ?? CommonConfig.logical_delete。
   */
  active_only?: boolean
  /** 索引级逻辑删除配置覆盖（逐键覆盖项目级配置，未配置的键回退项目级） */
  logical_delete?: LogicalDeleteConfig
  comment?: string
  mysql?: IndexOverride
  postgresql?: Omit<IndexOverride, 'using'>
  sqlite?: Omit<IndexOverride, 'using'>
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

/**
 * 表级分区配置，按方言分别配置（与 Field/Index 的 mysql?/postgresql?/sqlite? 覆盖模式一致）。
 *
 * 注意：SQLite 不支持 `PARTITION BY`，此处的 `sqlite` 仅为「按方言索引配置」的结构完整性而保留，
 * SQLite 生成器不会输出分区子句，UI 也不提供该方言的分区编辑入口。
 */
export interface TablePartitionConfig {
  mysql?: PartitionByConfig
  postgresql?: PartitionByConfig
  sqlite?: PartitionByConfig
}

export interface Table {
  name: string
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
  /**
   * SQLite 方言配置。
   * 可选：旧版本 common.json 不含该键，缺失时按默认行为处理
   * （quote_identifiers 视为 true、无全局前后置 SQL），读取处需用可选链容错。
   */
  sqlite?: {
    /** 生成 SQL 时是否用双引号包裹表名/列名（SQLite 兼容单引号与反引号，双引号为标准写法） */
    quote_identifiers?: boolean
    /** 全局前置 SQL（SQLite 方言） */
    pre_sql?: string
    /** 全局后置 SQL（SQLite 方言） */
    post_sql?: string
  }
}

export interface CommonConfig {
  struct_version?: string  // 结构版本号，缺省为 "0.0"
  /** 项目名称：展示在网页标题与顶部菜单栏；缺省或为空时回退到应用默认标题 */
  project_name?: string
  /** 项目描述：仅用于说明项目用途，不参与 SQL 生成 */
  project_description?: string
  /**
   * 项目级启用的 SQL 方言（多选）。
   * 仅启用的方言会出现在各处方言切换页签中，并按此生成 output/ 下的 SQL；
   * 缺省（未配置或为空）视为全部启用，且至少保留一种方言。
   */
  enabled_dialects?: SqlDialect[]
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
  /** 项目级逻辑删除配置：声明逻辑删除字段与唯一索引的落地策略，索引级可覆盖 */
  logical_delete?: LogicalDeleteConfig
}

/**
 * 单行初始数据（行内结构）。
 * 行数据与其注释/跳过标记内聚在同一对象，根除旧「平行数组靠索引对齐」的脆弱性。
 */
export interface InitialDataRow {
  /** 行的字段数据 */
  data: Record<string, any>
  /** 该行的字段级注释（仅有注释的字段才出现） */
  field_comments?: Record<string, string>
  /** 标记为「SQL 表达式」的字段：值为任意 SQL 表达式，生成 INSERT 时不加引号原样输出（如 CURRENT_TIMESTAMP()），仅字符串类字段有意义 */
  expr_fields?: Record<string, boolean>
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
