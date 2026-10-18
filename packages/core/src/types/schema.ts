import type { SqlDialect } from '../utils/sql-generator/shared'

/** Pre/post SQL statements (configured per dialect) */
export interface SqlStatements {
  mysql?: string
  postgresql?: string
  sqlite?: string
}

/** Field type case conversion mode */
export type TypeCaseMode = 'keep' | 'lowercase' | 'uppercase' | 'pascal'

/** Default value input component type */
export type DefaultInputType = 'text' | 'boolean'

// Unified top-level type — database dialect mapping
export interface UnifiedTypeDbMapping {
  type: string
  length?: number | null
  scale?: number | null
}

export interface UnifiedTypeDefinition {
  name: string
  description?: string
  /** Whether the default value needs to be wrapped in quotes (string types=true, number/bool types=false) */
  quote_default?: boolean
  /** Input component type for the default value (text=input box, boolean=TRUE/FALSE dropdown); defaults to text when omitted */
  default_input?: DefaultInputType
  mysql: UnifiedTypeDbMapping
  postgresql: UnifiedTypeDbMapping
  /**
   * SQLite dialect mapping.
   * Optional: the unified_types in older common.json files do not contain this key; when missing it is treated as
   * "no type restriction" (falls back to the field-level field_type), so parsing chains must tolerate undefined.
   */
  sqlite?: UnifiedTypeDbMapping
}

/**
 * Field comment option meaning configuration entry.
 * Used to automatically append "value-meaning" enumerations after the field comment (e.g. 0-disabled, 1-enabled, default 1).
 * value is the common value; mysql/postgresql/sqlite are optional dialect overrides (fall back to value when omitted).
 */
export interface CommentOption {
  /** Option meaning label (e.g. "enabled") */
  label: string
  /** Common value (each dialect uses this value by default) */
  value: string
  /** MySQL dialect override value (uses value when omitted) */
  mysql?: string
  /** PostgreSQL dialect override value (uses value when omitted) */
  postgresql?: string
  /** SQLite dialect override value (uses value when omitted) */
  sqlite?: string
}

/**
 * Value domain for initial data cells and field defaults: JSON scalars, or already-parsed nested structures.
 * Nested levels are not modeled layer by layer; values read from disk are all held as unknown and narrowed where used.
 */
export type JsonValue = string | number | boolean | null | undefined | unknown[] | Record<string, unknown>

export interface JsonObject {
  [key: string]: JsonValue
}

// Database-specific override for a field
export interface FieldOverride {
  field_type?: string
  field_length?: number | null
  field_scale?: number | null
  default?: JsonValue
}

// Database-specific override for an index
export interface IndexOverride {
  type?: string
  name?: string
  using?: string  // mysql only
}

/** Implementation strategy for MySQL logical-delete-aware unique indexes */
export type LogicalDeleteMysqlStrategy = 'functional' | 'timestamp_union'

/**
 * Logical delete configuration: declares which field is the logical delete marker and how unique indexes avoid the problem of "deleted rows still occupying uniqueness".
 *
 * Two levels:
 * - Project level: `CommonConfig.logical_delete` (global default)
 * - Index level: `Index.logical_delete` (overrides same-named keys at project level; falls back to project level when omitted)
 */
export interface LogicalDeleteConfig {
  /** Whether logical delete awareness is enabled; when disabled, active_only on indexes has no effect */
  enabled?: boolean
  /** Logical delete field name; if the field does not exist in a table, that table's indexes degrade to plain unique indexes */
  field?: string
  /**
   * Predicate for "not deleted" (an incomplete WHERE condition, without the WHERE keyword).
   * Derived from field when omitted: if the field name contains delete/del (or has timestamp semantics) → `<field> IS NULL`, otherwise → `<field> = 0`.
   */
  predicate?: string
  /**
   * MySQL implementation strategy (MySQL does not support partial indexes, so it must be worked around):
   * - `functional`: functional index `((IF(<field> IS NULL, col, NULL)))`, requires MySQL 8.0.13+
   * - `timestamp_union`: merge the logical delete column into the index columns; that column must be written with a different value on each delete (timestamp / primary key), compatible with 5.7
   */
  mysql_strategy?: LogicalDeleteMysqlStrategy
}

// Database-specific override for an index column (sort direction)
export interface IndexColumnDbOverride {
  sort_order?: 'ASC' | 'DESC'
}

// Index column (structured object, replacing the old plain string)
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
  /** Name of a type in CommonConfig.unified_types; when empty, falls back to free-text field_type */
  unified_type?: string
  field_type?: string
  field_length?: number | null
  field_scale?: number | null
  /** When checked, force skipping length output so the (N) part is not generated in SQL; meaningless field_length is removed automatically when saving */
  field_length_disabled?: boolean
  /** When checked, force skipping scale output; meaningless field_scale is removed automatically when saving */
  field_scale_disabled?: boolean
  not_null?: boolean
  primary_key?: boolean
  /** Whether the default value needs quotes (overrides the unified_type setting; only effective for custom types) */
  quote_default?: boolean
  default?: JsonValue
  /** MySQL: append `ON UPDATE CURRENT_TIMESTAMP[(n)]` (for "last modified time" fields); not emitted for other dialects */
  on_update_current_timestamp?: boolean
  /**
   * Fractional-second precision of `ON UPDATE CURRENT_TIMESTAMP` (0-6).
   * When empty, no parentheses are emitted (`ON UPDATE CURRENT_TIMESTAMP`); when numeric, `CURRENT_TIMESTAMP(n)` is emitted.
   */
  on_update_current_timestamp_precision?: number | null
  comment?: string
  /** When checked, append option meanings automatically after the comment (generated from comment_options, varies by dialect) */
  comment_options_enabled?: boolean
  /** List of comment option meaning configuration entries */
  comment_options?: CommentOption[]
  is_commented_out?: boolean
  mysql?: FieldOverride
  postgresql?: FieldOverride
  sqlite?: FieldOverride
}

export interface Index {
  // name is optional
  name?: string
  /** When checked, do not specify an index name: MySQL omits it and lets the database name it, while PostgreSQL / SQLite fall back to "prefix + column names" */
  use_default_name?: boolean
  type: string
  using?: string
  columns: IndexColumn[]
  /**
   * The unique index constrains only "not deleted" rows (logical delete aware), avoiding the conflict between soft delete and unique indexes.
   * Only effective for unique indexes; the concrete field name / strategy come from Index.logical_delete ?? CommonConfig.logical_delete.
   */
  active_only?: boolean
  /** Index-level logical delete configuration override (overrides project-level configuration key by key; unset keys fall back to project level) */
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
 * Partition table configuration for a single dialect (PARTITION BY).
 * Uses "structured strategy + columns" as the primary approach, with a raw expression fallback:
 * - Set `strategy` + `columns` → generate `PARTITION BY <strategy> (col1, col2)`
 * - Set only `expression` → generate `PARTITION BY <expression>` directly (covers all dialect differences,
 *   e.g. MySQL's `RANGE COLUMNS` / `KEY (...)` or PostgreSQL's `RANGE (to_days(...))`, etc.)
 */
export interface PartitionByConfig {
  /** Partition strategy, e.g. RANGE / LIST / HASH / KEY (MySQL) / RANGE COLUMNS (MySQL), etc. */
  strategy?: string
  /** Partition key column names (used in structured mode) */
  columns?: string[]
  /** Raw partition expression (fallback mode, generates `PARTITION BY <expression>`) */
  expression?: string
}

/**
 * Table-level partition configuration, configured per dialect (consistent with the mysql?/postgresql?/sqlite? override pattern of Field/Index).
 *
 * Note: SQLite does not support `PARTITION BY`; the `sqlite` key here is retained only for structural completeness of per-dialect configuration,
 * the SQLite generator never emits partition clauses, and the UI offers no partition editing entry for that dialect.
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
  /** Partition table configuration (PARTITION BY configured per dialect); no partition clause is generated when empty */
  partition?: TablePartitionConfig
  fields: Field[]
  indexes: Index[]
  /** Pre SQL (configured per dialect, generated before CREATE TABLE and INSERT) */
  pre_sql?: SqlStatements
  /** Post SQL (configured per dialect, generated after CREATE TABLE and INSERT) */
  post_sql?: SqlStatements
}

export interface Schema {
  schema: string
  tables: Table[]
  /** Pre SQL (configured per dialect, generated before all tables) */
  pre_sql?: SqlStatements
  /** Post SQL (configured per dialect, generated after all tables) */
  post_sql?: SqlStatements
}

export type TableDdlMode = 'create' | 'drop_and_create' | 'create_if_not_exists'

export interface DefaultConfig {
  /** DDL generation strategy: create=plain CREATE TABLE, drop_and_create=DROP+CREATE, create_if_not_exists=CREATE IF NOT EXISTS */
  table_ddl_mode?: TableDdlMode
  mysql: {
    database: Record<string, unknown>
    table: {
      mysql_engine: string
      mysql_charset: string
      mysql_collation: string
    }
    /** Global pre SQL (MySQL dialect) */
    pre_sql?: string
    /** Global post SQL (MySQL dialect) */
    post_sql?: string
  }
  postgresql: {
    quote_identifiers: boolean
    /** Global pre SQL (PostgreSQL dialect) */
    pre_sql?: string
    /** Global post SQL (PostgreSQL dialect) */
    post_sql?: string
  }
  /**
   * SQLite dialect configuration.
   * Optional: older common.json files do not contain this key; when missing, default behavior applies
   * (quote_identifiers treated as true, no global pre/post SQL), and reading code must tolerate it with optional chaining.
   */
  sqlite?: {
    /** Whether to wrap table/column names in double quotes when generating SQL (SQLite supports single quotes and backticks; double quotes are the standard form) */
    quote_identifiers?: boolean
    /** Global pre SQL (SQLite dialect) */
    pre_sql?: string
    /** Global post SQL (SQLite dialect) */
    post_sql?: string
  }
}

export interface CommonConfig {
  struct_version?: string  // Struct version number, defaults to "0.0"
  /** Project name: shown in the page title and top menu bar; falls back to the app default title when missing or empty */
  project_name?: string
  /** Project description: only describes the purpose of the project; not involved in SQL generation */
  project_description?: string
  /**
   * SQL dialects enabled at the project level (multi-select).
   * Only enabled dialects appear in the dialect switch tabs everywhere and are used to generate the SQL under output/;
   * when omitted (unconfigured or empty) all dialects are considered enabled, and at least one dialect is kept.
   */
  enabled_dialects?: SqlDialect[]
  default_config: DefaultConfig
  schema_order?: string[]
  common_used_fields: Record<string, Field>
  /** Maintains the display order of common_used_fields (bypassing JS object auto-sorting of purely numeric keys) */
  common_used_field_order?: string[]
  /** Unified top-level type definitions — each top-level type maps to a concrete type per database dialect */
  unified_types?: UnifiedTypeDefinition[]
  /** Field type case: keep=as-is, lowercase=all lowercase, uppercase=all uppercase, pascal=PascalCase */
  type_case?: TypeCaseMode
  /** Whether to generate the AI JSON structure guide (AI_JSON_STRUCTURE_GUIDE.md) in the current project folder; defaults to false */
  generate_ai_guide?: boolean
  /** Project-level logical delete configuration: declares the logical delete field and unique index strategy; index level can override */
  logical_delete?: LogicalDeleteConfig
}

/**
 * A single initial data row (row-inline structure).
 * Row data and its comment/skip markers are grouped in the same object, eliminating the fragility of the old "parallel arrays aligned by index".
 */
export interface InitialDataRow {
  /** Field data of the row */
  data: JsonObject
  /** Field-level comments for this row (only fields with comments appear) */
  field_comments?: Record<string, string>
  /** Fields marked as "SQL expression": the value is an arbitrary SQL expression, output verbatim without quotes when generating INSERT (e.g. CURRENT_TIMESTAMP()); only meaningful for string-type fields */
  expr_fields?: Record<string, boolean>
  /** Whether to skip this row (when true, no INSERT statement is generated for this row; same meaning as the old skip_rows[i]===true) */
  is_skip?: boolean
  /** Row-level comment (optional) */
  row_comment?: string
}

/**
 * Initial data INSERT generation mode:
 * - insert: plain INSERT INTO
 * - ignore: skip rows that conflict with existing unique keys
 * - overwrite: update existing rows on unique-key conflict
 */
export type InitialDataInsertMode = 'insert' | 'ignore' | 'overwrite'

export interface InitialData {
  /** Row-inline data rows; undefined when the data section has not been initialized, [] for an empty table */
  rows?: InitialDataRow[]
  /** INSERT generation mode; omitted means plain INSERT */
  insert_mode?: InitialDataInsertMode
  /** Pre SQL (configured per dialect, generated before INSERT) */
  pre_sql?: SqlStatements
  /** Post SQL (configured per dialect, generated after INSERT) */
  post_sql?: SqlStatements
}

/**
 * Legacy initial data structure (four parallel arrays, aligned by index).
 * Only used by the upgrader to read the old on-disk format; the runtime in-memory state always uses the {@link InitialData} row-inline structure.
 */
export interface LegacyInitialData {
  rows?: JsonObject[]
  row_comments?: (string | null)[]
  field_comments?: (Record<string, string> | null)[]
  /** Per-row skip markers: when skip_rows[i] === true, no INSERT statement is generated for that row */
  skip_rows?: (boolean | null)[]
  /** Pre SQL (configured per dialect, generated before INSERT) */
  pre_sql?: SqlStatements
  /** Post SQL (configured per dialect, generated after INSERT) */
  post_sql?: SqlStatements
}
