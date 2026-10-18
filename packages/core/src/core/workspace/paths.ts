/**
 * Business path resolution: combines `layout.ts` (path constants) and `handles.ts` (handle primitives),
 * exposing semantic directory/file handle acquisition to `editor.ts` / `file-helpers.ts`.
 *
 * Covers both the legacy layout (before the refactor) and the new layout (current/versions/migrations);
 * legacy-compatible reads resolve through this module so that "upgrade project structure" can perform a one-time migration (see `utils/structure-migrations/`).
 * Derived SQL is no longer resolved here: files under output/ are written directly by path by the workspace session.
 */

import {
  COMMON_FILE,
  SCHEMAS_DIR,
  INITIAL_DATA_DIR,
  CURRENT_DIR,
  VERSIONS_DIR,
  MIGRATIONS_DIR,
  ENVIRONMENTS_DIR,
  DATABASE_FILE,
  TABLE_FILE,
  INITIAL_DATA_FILE,
} from './layout'

import {
  getOrCreateDir,
  getFileHandleSafe,
  removeEntry,
} from './handles'

// ===== Legacy layout (before the refactor) path resolution =====

/** File handle for the root common.json */
export function getCommonFileHandle(
  root: FileSystemDirectoryHandle,
  create = true,
): Promise<FileSystemFileHandle> {
  return getFileHandleSafe(root, COMMON_FILE, create)
}

/** Directory handle for the legacy schemas/ directory */
export function getSchemasDir(
  root: FileSystemDirectoryHandle,
  create = true,
): Promise<FileSystemDirectoryHandle> {
  return getOrCreateDir(root, SCHEMAS_DIR, create)
}

/** Directory handle for the legacy initial-data/ directory */
export function getInitialDataDir(
  root: FileSystemDirectoryHandle,
  create = true,
): Promise<FileSystemDirectoryHandle> {
  return getOrCreateDir(root, INITIAL_DATA_DIR, create)
}

/** Remove the legacy initial-data/<schema>/<table>.json */
export function removeOldInitialDataFile(
  schemaDir: FileSystemDirectoryHandle,
  tableName: string,
): Promise<void> {
  return removeEntry(schemaDir, `${tableName}.json`)
}

// ===== New layout (current/versions/migrations) path resolution =====

/** Directory handle for current/ */
export function getCurrentDir(
  root: FileSystemDirectoryHandle,
  create = true,
): Promise<FileSystemDirectoryHandle> {
  return getOrCreateDir(root, CURRENT_DIR, create)
}

/** File handle for current/database.json */
export function getCurrentDatabaseFileHandle(
  currentDir: FileSystemDirectoryHandle,
  create = true,
): Promise<FileSystemFileHandle> {
  return getFileHandleSafe(currentDir, DATABASE_FILE, create)
}

/** Directory handle for current/schemas/ */
export function getCurrentSchemasDir(
  currentDir: FileSystemDirectoryHandle,
  create = true,
): Promise<FileSystemDirectoryHandle> {
  return getOrCreateDir(currentDir, SCHEMAS_DIR, create)
}

/** Directory handle for current/schemas/<schemaName>/ */
export function getSchemaDirUnderCurrent(
  schemasDir: FileSystemDirectoryHandle,
  schemaName: string,
  create = true,
): Promise<FileSystemDirectoryHandle> {
  return getOrCreateDir(schemasDir, schemaName, create)
}

/** Directory handle for current/schemas/<schemaName>/<tableName>/ */
export function getTableDirUnderSchema(
  schemaDir: FileSystemDirectoryHandle,
  tableName: string,
  create = true,
): Promise<FileSystemDirectoryHandle> {
  return getOrCreateDir(schemaDir, tableName, create)
}

/** File handle for table.json (inside the table directory) */
export function getTableFileHandle(
  tableDir: FileSystemDirectoryHandle,
  create = true,
): Promise<FileSystemFileHandle> {
  return getFileHandleSafe(tableDir, TABLE_FILE, create)
}

/** File handle for initial-data.json (inside the table directory) */
export function getInitialDataFileHandle(
  tableDir: FileSystemDirectoryHandle,
  create = true,
): Promise<FileSystemFileHandle> {
  return getFileHandleSafe(tableDir, INITIAL_DATA_FILE, create)
}

/** Directory handle for versions/ */
export function getVersionsDir(
  root: FileSystemDirectoryHandle,
  create = true,
): Promise<FileSystemDirectoryHandle> {
  return getOrCreateDir(root, VERSIONS_DIR, create)
}

/** File handle for versions/<id>.json */
export function getVersionFileHandle(
  versionsDir: FileSystemDirectoryHandle,
  id: string,
  create = true,
): Promise<FileSystemFileHandle> {
  return getFileHandleSafe(versionsDir, `${id}.json`, create)
}

/** Directory handle for migrations/ */
export function getMigrationsDir(
  root: FileSystemDirectoryHandle,
  create = true,
): Promise<FileSystemDirectoryHandle> {
  return getOrCreateDir(root, MIGRATIONS_DIR, create)
}

/** File handle for migrations/<id>.json */
export function getMigrationFileHandle(
  migrationsDir: FileSystemDirectoryHandle,
  id: string,
  create = true,
): Promise<FileSystemFileHandle> {
  return getFileHandleSafe(migrationsDir, `${id}.json`, create)
}

/** Directory handle for environments/ */
export function getEnvironmentsDir(
  root: FileSystemDirectoryHandle,
  create = true,
): Promise<FileSystemDirectoryHandle> {
  return getOrCreateDir(root, ENVIRONMENTS_DIR, create)
}

/** File handle for environments/<id>.json */
export function getEnvironmentFileHandle(
  environmentsDir: FileSystemDirectoryHandle,
  id: string,
  create = true,
): Promise<FileSystemFileHandle> {
  return getFileHandleSafe(environmentsDir, `${id}.json`, create)
}
