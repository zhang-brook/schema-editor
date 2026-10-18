/**
 * The "project structure version" currently supported by the editor.
 *
 * Single source of truth for the structure version: written as struct_version in the root common.json of the new layout,
 * and used by the upgrade chain in `structure-migrations/` and by version comparisons in `file-helpers.ts`.
 * When changing the directory layout in the future, bump the version here and append the corresponding migration step to the structure-migrations registry.
 */
export const CURRENT_STRUCT_VERSION = '1.0'

/**
 * Workspace path fragment constants and file-name sanitization rules (pure constants and string rules, no business semantics).
 *
 * Serves as the project-wide "single source of truth for paths": the `current/versions/migrations` layout has fairly complex path rules,
 * so all path concatenation and handle acquisition must go through this module and `handles.ts` / `paths.ts`; never scatter hard-coded paths in business code.
 */

// ===== Legacy layout (before the refactor) path fragments =====

/** Root configuration file name */
export const COMMON_FILE = 'common.json'

/** Legacy layout: directory containing all schema files (under the root) */
export const SCHEMAS_DIR = 'schemas'

/** Legacy layout: initial data directory (under the root) */
export const INITIAL_DATA_DIR = 'initial-data'

/** Legacy layout: SQL output directory (under the root) */
export const OUTPUT_DIR = 'output'

// ===== New layout (current/versions/migrations) path fragments =====

/** Directory of the version currently being edited (fixed name) */
export const CURRENT_DIR = 'current'

/** Directory of historical version snapshots */
export const VERSIONS_DIR = 'versions'

/** Directory of user-maintained migration scripts */
export const MIGRATIONS_DIR = 'migrations'

/** Directory of environment definitions */
export const ENVIRONMENTS_DIR = 'environments'

/** database.json under the current version (schema order + version-related configuration) */
export const DATABASE_FILE = 'database.json'

/** schema.json inside the schema directory (original schema name + table ordering) */
export const SCHEMA_FILE = 'schema.json'

/** table.json inside the table directory (table configuration items) */
export const TABLE_FILE = 'table.json'

/** initial-data.json inside the table directory (row-based initial data) */
export const INITIAL_DATA_FILE = 'initial-data.json'

// ===== File-name sanitization =====

/**
 * Turn schema / table names into file-name friendly fragments:
 * - Replace filesystem-illegal characters (path separators, Windows reserved characters, etc.) with underscores;
 * - Collapse consecutive underscores and trim leading/trailing underscores;
 * - Preserve the original casing (so the original name can be traced back).
 *
 * Only used for "on-disk file names"; the original semantic names remain stored in schema.json / table.json.
 */
export function sanitizeName(name: string): string {
  if (!name) return ''

  const replaced = name
    // Path separators and common illegal characters
    .replace(/[/\\<>:"|?*]/g, '_')
    // Control characters (\p{Cc} is equivalent to \x00-\x1f)
    .replace(/\p{Cc}/gu, '_') // .replace(/[\x00-\x1f]/g, '_')
    // Collapse consecutive underscores
    .replace(/_+/g, '_')
    // Trim leading/trailing underscores and whitespace
    .replace(/^_+|_+$/g, '')
    .trim()

  return replaced
}
