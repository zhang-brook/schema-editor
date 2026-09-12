/**
 * 版本(version)与迁移脚本(migration)的核心类型定义。
 *
 * 存储布局：
 *   versions/<id>.json   单个大 JSON，含完整 database + schemas + tables + initial-data（只读历史快照）
 *   migrations/<id>.json  迁移脚本（选两版本 → steps → 合并 DDL）
 *
 * 身份识别设计（不依赖持久化 id）：
 * 结构对象本身不携带任何唯一 id，"两个版本里的对象是否为同一个"由迁移脚本上记录的
 * 改名事实（RenameEntry）回答；记录缺失时退化为相似度推断（见 core/version/matcher.ts）。
 */
import type { CommonConfig, InitialData, Schema } from '@/types/schema'

// ===== 对象路径 =====

/**
 * 结构对象在某一版本快照内的路径，是身份识别的载体。
 *   schema  `db`
 *   table   `db/users`
 *   field   `db/users.name`
 *   index   `db/users#idx_name`
 */
export type ObjectPath = string

/** 可被改名追踪的对象种类 */
export type RenameKind = 'schema' | 'table' | 'field' | 'index'

/** 路径分隔符：`.` 用于字段，`#` 用于索引，`/` 用于 schema 下的表 */
export const PATH_TABLE_SEP = '/'
export const PATH_FIELD_SEP = '.'
export const PATH_INDEX_SEP = '#'

// ===== 版本快照 =====

/** 版本快照的完整内容（current/ 某个时刻的深拷贝） */
export interface VersionSnapshot {
  /** 版本 id（v_xxx） */
  id: string
  /** 人类可读名称，如 "v1.0" */
  name: string
  /** 创建时间戳（ISO 字符串） */
  created_at: string
  /** 所属结构版本 */
  struct_version: string
  /** 创建本版本时的基线版本 id；首个版本为 undefined。用于串成线性版本链 */
  parent_id?: string
  /** 根 common 配置（与 current/ 同构，但不含 schema_order） */
  common: CommonConfig
  /** schema_order（来自 current/database.json） */
  schema_order: string[]
  /** 各表初始数据，key 为 `${schema}/${table}` */
  initial_data: Record<string, InitialData>
  /** 各 schema（含表、字段、索引） */
  schemas: Schema[]
}

/** 版本列表项（轻量，用于 UI 展示，不加载完整快照） */
export interface VersionSummary {
  id: string
  name: string
  created_at: string
  /** 基线版本 id；首个版本为 undefined。用于串成版本链 */
  parent_id?: string
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
  /** 旧字段名（rename / 删除 / 修改前） */
  old_name?: string
  /** 新字段名（rename / 新增 / 修改后） */
  new_name?: string
  /** 修改项的字段级差异（key → [old, new]） */
  changes?: Record<string, [any, any]>
}

export interface IndexDiff {
  type: DiffChangeType
  /** 旧索引标识（name 或 列签名） */
  old_name?: string
  new_name?: string
  changes?: Record<string, [any, any]>
}

export interface TableDiff {
  type: 'table_added' | 'table_removed' | 'table_renamed'
  old_name?: string
  new_name?: string
  /** 表内细粒度变更（仅 renamed 时可能同时存在字段/索引改动由下方字段承载） */
  fields: FieldDiff[]
  indexes: IndexDiff[]
}

export interface SchemaDiff {
  schema: string
  tables: TableDiff[]
}

export interface StructureDiff {
  from: VersionRef | null
  to: VersionRef | CurrentRef
  schemas: SchemaDiff[]
  /** 是否存在任何变更 */
  hasChanges: boolean
}

/** 版本引用（用于 diff 的 from 端） */
export interface VersionRef {
  kind: 'version'
  id: string
  name: string
}

/** 当前工作区引用（用于 diff 的 to 端） */
export interface CurrentRef {
  kind: 'current'
}

// ===== 身份识别：改名事实 =====

/** 改名记录的来源 */
export type RenameSource =
  /** 编辑器内捕获的重命名操作，可直接采信 */
  | 'editor'
  /** 相似度自动推断，需经用户确认后才等同 editor */
  | 'auto'
  /** 用户在迁移编辑器中手工连线确认 */
  | 'manual'

/**
 * 一条改名事实：某对象在本次迁移覆盖的范围内，路径由 from 变为 to。
 *
 * 与持久化 id 的区别：这是「过程记录」而非「对象属性」，
 * 不写入 current/ 下的结构定义，只在迁移脚本上累积。
 * 计算任意两版本的对应关系时，对所有历史迁移的 renames 做传递闭包查询。
 */
export interface RenameEntry {
  kind: RenameKind
  /** 源路径 */
  from: ObjectPath
  /** 目标路径 */
  to: ObjectPath
  source: RenameSource
  /** 置信度 0~1；editor / manual 恒为 1，auto 由 matcher 给出 */
  confidence?: number
}

// ===== 环境 =====

/**
 * 环境：代表一个实际部署目标（开发 / 测试 / 生产等）。
 * 每个环境关联到版本链上的某个版本，表示「该环境当前处于这个版本」。
 */
export interface Environment {
  /** 环境 id（e_xxx） */
  id: string
  name: string
  /** 该环境当前所处的版本 id */
  version_id: string
  /** 备注 */
  note?: string
  created_at: string
  updated_at: string
}

// ===== 迁移脚本 =====

export type MigrationStepType = 'auto_diff' | 'clear_column' | 'sql_transform' | 'custom_sql'

/** auto_diff：自动基于两版本（from→to）结构差异生成 DDL；可选仅针对特定表 */
export interface AutoDiffStep {
  type: 'auto_diff'
  /** 限制生成范围到指定表（`schema/table` 路径），省略则全量 */
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
  /** 方言特定的 SQL；某方言留空则该方言不输出此步骤 */
  mysql?: string
  postgresql?: string
  sqlite?: string
}

/** custom_sql：完全自定义的 DDL/DML 片段 */
export interface CustomSqlStep {
  type: 'custom_sql'
  mysql?: string
  postgresql?: string
  sqlite?: string
}

export type MigrationStep = AutoDiffStep | ClearColumnStep | SqlTransformStep | CustomSqlStep

/** 迁移在某个环境下的执行状态与针对性备注 */
export interface EnvMigrationStatus {
  executed: boolean
  executed_at?: string
  /** 针对该环境的备注（如执行时的注意事项、回滚方式） */
  note?: string
}

export interface Migration {
  id: string
  name: string
  /** 源版本 id（from） */
  from_version: string
  /** 目标版本 id（to） */
  to_version: string
  /** 本次迁移确认过的改名事实，用于身份识别 */
  renames: RenameEntry[]
  /** 步骤有序列表 */
  steps: MigrationStep[]
  /** 迁移备注 */
  note?: string
  /** 各环境下的执行状态，key 为环境 id */
  env_status?: Record<string, EnvMigrationStatus>
  created_at: string
  updated_at: string
}

/** 迁移最终预览结果（合并所有步骤后，按方言输出） */
export interface MigrationDdlPreview {
  mysql: string
  postgresql: string
  sqlite: string
}
