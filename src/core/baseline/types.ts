/**
 * 基线(baseline)与迁移脚本(migration)的核心类型定义。
 *
 * 存储布局（见 docs/refactor/15）：
 *   baselines/<id>.json   单个大 JSON，含完整 database + schemas + tables + initial-data（只读历史快照）
 *   migrations/<id>.json  迁移脚本（选两基线 → steps → 合并 DDL）
 */
import type { CommonConfig, InitialData, Schema } from '@/types/schema'

/** 基线快照的完整内容（current/ 某个时刻的深拷贝） */
export interface BaselineSnapshot {
  /** 基线 id（b_xxx） */
  id: string
  /** 人类可读名称，如 "v1.0" */
  name: string
  /** 创建时间戳（ISO 字符串） */
  created_at: string
  /** 所属结构版本 */
  struct_version: string
  /** 根 common 配置（与 current/ 同构，但不含 schema_order） */
  common: CommonConfig
  /** schema_order（来自 current/database.json） */
  schema_order: string[]
  /** 各表初始数据，key 为 `${schema}/${table}` */
  initial_data: Record<string, InitialData>
  /** 各 schema（含表、字段、索引） */
  schemas: Schema[]
}

/** 基线列表项（轻量，用于 UI 展示，不加载完整快照） */
export interface BaselineSummary {
  id: string
  name: string
  created_at: string
}

// ===== 结构 diff 结果 =====

export type DiffChangeType =
  | 'table_added'
  | 'table_removed'
  | 'table_renamed'
  | 'field_added'
  | 'field_removed'
  | 'field_renamed'
  | 'field_modified'
  | 'index_added'
  | 'index_removed'
  | 'index_modified'

export interface FieldDiff {
  type: DiffChangeType
  /** field_id（若存在），用于稳定匹配 */
  field_id?: string
  /** 旧字段名（rename / 删除 / 修改前） */
  old_name?: string
  /** 新字段名（rename / 新增 / 修改后） */
  new_name?: string
  /** 修改项的字段级差异（key → [old, new]） */
  changes?: Record<string, [any, any]>
}

export interface IndexDiff {
  type: DiffChangeType
  /** index_id（若存在），用于稳定匹配 */
  index_id?: string
  /** 旧索引标识（name 或 列签名） */
  old_name?: string
  new_name?: string
  changes?: Record<string, [any, any]>
}

export interface TableDiff {
  type: 'table_added' | 'table_removed' | 'table_renamed'
  table_id?: string
  old_name?: string
  new_name?: string
  /** 表内细粒度变更（仅 renamed 时可能同时存在字段/索引改动由下方字段承载） */
  fields: FieldDiff[]
  indexes: IndexDiff[]
}

export interface SchemaDiff {
  schema_id?: string
  schema: string
  tables: TableDiff[]
}

export interface StructureDiff {
  from: BaselineRef | null
  to: BaselineRef | CurrentRef
  schemas: SchemaDiff[]
  /** 是否存在任何变更 */
  hasChanges: boolean
}

/** 基线引用（用于 diff 的 from 端） */
export interface BaselineRef {
  kind: 'baseline'
  id: string
  name: string
}

/** 当前工作区引用（用于 diff 的 to 端） */
export interface CurrentRef {
  kind: 'current'
}

// ===== 迁移脚本 =====

export type MigrationStepType =
  | 'auto_diff'
  | 'clear_column'
  | 'sql_transform'
  | 'custom_sql'

/** auto_diff：自动基于两基线（from→to）结构差异生成 DDL；可选仅针对特定表 */
export interface AutoDiffStep {
  type: 'auto_diff'
  /** 限制生成范围到指定表（table_id 列表），省略则全量 */
  only_tables?: string[]
}

/** clear_column：迁移旧数据时清空某列（如字段改名后旧列数据清理） */
export interface ClearColumnStep {
  type: 'clear_column'
  schema: string
  table: string
  column: string
}

/** sql_transform：对初始数据做 SQL 变换（如 UPDATE/DELETE，作用于迁移后的数据） */
export interface SqlTransformStep {
  type: 'sql_transform'
  /** 方言特定的 SQL，缺省方言时回退到 both */
  mysql?: string
  postgresql?: string
}

/** custom_sql：完全自定义的 DDL/DML 片段 */
export interface CustomSqlStep {
  type: 'custom_sql'
  mysql?: string
  postgresql?: string
}

export type MigrationStep =
  | AutoDiffStep
  | ClearColumnStep
  | SqlTransformStep
  | CustomSqlStep

export interface Migration {
  id: string
  name: string
  /** 源基线 id（from） */
  from_baseline: string
  /** 目标基线 id（to） */
  to_baseline: string
  /** 步骤有序列表 */
  steps: MigrationStep[]
  created_at: string
  updated_at: string
}

/** 迁移最终预览结果（合并所有步骤后，按方言输出） */
export interface MigrationDdlPreview {
  mysql: string
  postgresql: string
}
