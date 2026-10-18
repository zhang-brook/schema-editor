/**
 * Core type definitions for versions and migration scripts.
 *
 * Storage layout:
 *   versions/<id>.json    single large JSON holding the full database + schemas + tables + initial-data (read-only historical snapshot)
 *   migrations/<id>.json  migration script (pick two versions → steps → merged DDL)
 *
 * Identity design (no persisted ids):
 * Structure objects carry no unique id of their own; whether an object in two versions is the same is answered by the
 * rename facts (RenameEntry) recorded on migration scripts. When records are missing, this degrades to similarity
 * inference (see core/version/matcher.ts).
 */
import type { CommonConfig, InitialData, Schema } from '../../types/schema'

// ===== Object paths =====

/**
 * Path of a structure object within a version snapshot; the carrier of identity.
 *   schema  `db`
 *   table   `db/users`
 *   field   `db/users.name`
 *   index   `db/users#idx_name`
 */
export type ObjectPath = string

/** Object kinds that can be tracked for renames */
export type RenameKind = 'schema' | 'table' | 'field' | 'index'

/** Path separators: `.` for fields, `#` for indexes, `/` for tables under a schema */
export const PATH_TABLE_SEP = '/'
export const PATH_FIELD_SEP = '.'
export const PATH_INDEX_SEP = '#'

// ===== Version snapshots =====

/** Full contents of a version snapshot (a deep copy of current/ at a point in time) */
export interface VersionSnapshot {
  /** Version id (v_xxx) */
  id: string
  /** Human-readable name, e.g. "v1.0" */
  name: string
  /** Creation timestamp (ISO string) */
  created_at: string
  /** Structure version this snapshot belongs to */
  struct_version: string
  /** Base version id when this version was created; undefined for the first version. Used to form a linear version chain */
  parent_id?: string
  /** Root common config (same shape as current/, but without schema_order) */
  common: CommonConfig
  /** schema_order (from current/database.json) */
  schema_order: string[]
  /** Initial data per table, keyed by `${schema}/${table}` */
  initial_data: Record<string, InitialData>
  /** Schemas (including tables, fields, indexes) */
  schemas: Schema[]
}

/** Version list item (lightweight, for UI display; does not load the full snapshot) */
export interface VersionSummary {
  id: string
  name: string
  created_at: string
  /** Base version id; undefined for the first version. Used to form the version chain */
  parent_id?: string
}

// ===== Structure diff results =====

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
  /** Old field name (before rename / removal / modification) */
  old_name?: string
  /** New field name (after rename / addition / modification) */
  new_name?: string
  /** Field-level differences for modified items (key → [old, new]) */
  changes?: Record<string, [unknown, unknown]>
}

export interface IndexDiff {
  type: DiffChangeType
  /** Old index identifier (name or column signature) */
  old_name?: string
  new_name?: string
  changes?: Record<string, [unknown, unknown]>
}

export interface TableDiff {
  type: 'table_added' | 'table_removed' | 'table_renamed'
  old_name?: string
  new_name?: string
  /** Fine-grained changes within the table (only possible for renamed; field/index changes live in fields below) */
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
  /** Whether there are any changes */
  hasChanges: boolean
}

/** Version reference (used for the from side of a diff) */
export interface VersionRef {
  kind: 'version'
  id: string
  name: string
}

/** Current workspace reference (used for the to side of a diff) */
export interface CurrentRef {
  kind: 'current'
}

// ===== Identity: rename facts =====

/** Source of a rename record */
export type RenameSource =
  /** Rename operation captured in the editor; can be trusted directly */
  | 'editor'
  /** Automatically inferred by similarity; only equals editor after user confirmation */
  | 'auto'
  /** Manually linked and confirmed by the user in the migration editor */
  | 'manual'

/**
 * A single rename fact: within the scope covered by this migration, an object's path changed from `from` to `to`.
 *
 * Unlike persisted ids, this is a record of a process rather than an object attribute:
 * it is not written into the structure definitions under current/, only accumulated on migration scripts.
 * To compute correspondence between any two versions, query the transitive closure over all historical migrations' renames.
 */
export interface RenameEntry {
  kind: RenameKind
  /** Source path */
  from: ObjectPath
  /** Target path */
  to: ObjectPath
  source: RenameSource
  /** Confidence 0-1; always 1 for editor / manual, provided by the matcher for auto */
  confidence?: number
}

// ===== Environments =====

/**
 * Environment: represents an actual deployment target (development / testing / production, etc.).
 * Each environment is tied to a version in the version chain, meaning "this environment is currently on that version".
 */
export interface Environment {
  /** Environment id (e_xxx) */
  id: string
  name: string
  /** Id of the version this environment is currently on */
  version_id: string
  /** Note */
  note?: string
  created_at: string
  updated_at: string
}

// ===== Migration scripts =====

export type MigrationStepType = 'auto_diff' | 'clear_column' | 'sql_transform' | 'custom_sql'

/** auto_diff: generate DDL automatically from the structure diff between two versions (from→to); optionally limited to specific tables */
export interface AutoDiffStep {
  type: 'auto_diff'
  /** Limit generation to the given tables (`schema/table` paths); all tables if omitted */
  only_tables?: string[]
}

/** clear_column: clear a column while migrating old data (e.g. cleaning up old column data after a field rename) */
export interface ClearColumnStep {
  type: 'clear_column'
  schema: string
  table: string
  column: string
}

/** sql_transform: apply SQL transformations to initial data (e.g. UPDATE/DELETE on the migrated data) */
export interface SqlTransformStep {
  type: 'sql_transform'
  /** Dialect-specific SQL; if a dialect is left empty, this step is not emitted for that dialect */
  mysql?: string
  postgresql?: string
  sqlite?: string
}

/** custom_sql: fully custom DDL/DML fragment */
export interface CustomSqlStep {
  type: 'custom_sql'
  mysql?: string
  postgresql?: string
  sqlite?: string
}

export type MigrationStep = AutoDiffStep | ClearColumnStep | SqlTransformStep | CustomSqlStep

/** Execution status and targeted notes of a migration in a given environment */
export interface EnvMigrationStatus {
  executed: boolean
  executed_at?: string
  /** Notes for this environment (e.g. execution caveats, rollback procedure) */
  note?: string
}

export interface Migration {
  id: string
  name: string
  /** Source version id (from) */
  from_version: string
  /** Target version id (to) */
  to_version: string
  /** Rename facts confirmed for this migration, used for identity resolution */
  renames: RenameEntry[]
  /** Ordered list of steps */
  steps: MigrationStep[]
  /** Migration note */
  note?: string
  /** Execution status per environment, keyed by environment id */
  env_status?: Record<string, EnvMigrationStatus>
  created_at: string
  updated_at: string
}

/** Final migration preview (after merging all steps, output per dialect) */
export interface MigrationDdlPreview {
  mysql: string
  postgresql: string
  sqlite: string
}
