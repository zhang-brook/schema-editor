/**
 * 业务路径解析：组合 `layout.ts`（路径常量）与 `handles.ts`（句柄原语），
 * 对 `editor.ts` / `file-helpers.ts` 暴露语义化的目录/文件句柄获取。
 *
 * 同时覆盖「旧结构（重构前）」与「新结构（current/baselines/migrations）」两种布局，
 * 旧结构兼容读取经本模块解析，便于后续「升级项目结构」按钮（docs/refactor/13）做一次性迁移。
 */

import {
  COMMON_FILE,
  SCHEMAS_DIR,
  INITIAL_DATA_DIR,
  OUTPUT_DIR,
  CURRENT_DIR,
  BASELINES_DIR,
  MIGRATIONS_DIR,
  DATABASE_FILE,
  TABLE_FILE,
  INITIAL_DATA_FILE,
} from './layout'

import {
  getOrCreateDir,
  getFileHandleSafe,
  removeEntry,
} from './handles'

// ===== 旧结构（重构前）路径解析 =====

/** 根目录 common.json 文件句柄 */
export function getCommonFileHandle(
  root: FileSystemDirectoryHandle,
  create = true,
): Promise<FileSystemFileHandle> {
  return getFileHandleSafe(root, COMMON_FILE, create)
}

/** 旧结构 schemas/ 目录句柄 */
export function getSchemasDir(
  root: FileSystemDirectoryHandle,
  create = true,
): Promise<FileSystemDirectoryHandle> {
  return getOrCreateDir(root, SCHEMAS_DIR, create)
}

/** 旧结构某 schema 的 <name>.json 文件句柄 */
export function getOldSchemaFileHandle(
  schemasDir: FileSystemDirectoryHandle,
  filename: string,
): Promise<FileSystemFileHandle> {
  return getFileHandleSafe(schemasDir, filename)
}

/** 删除旧结构某 schema 的 <name>.json */
export function removeOldSchemaFile(
  schemasDir: FileSystemDirectoryHandle,
  filename: string,
): Promise<void> {
  return removeEntry(schemasDir, filename)
}

/** 旧结构 initial-data/ 目录句柄 */
export function getInitialDataDir(
  root: FileSystemDirectoryHandle,
  create = true,
): Promise<FileSystemDirectoryHandle> {
  return getOrCreateDir(root, INITIAL_DATA_DIR, create)
}

/** 旧结构 initial-data/<schema>/<table>.json 文件句柄 */
export function getOldInitialDataFileHandle(
  schemaDir: FileSystemDirectoryHandle,
  tableName: string,
): Promise<FileSystemFileHandle> {
  return getFileHandleSafe(schemaDir, `${tableName}.json`)
}

/** 删除旧结构 initial-data/<schema>/<table>.json */
export function removeOldInitialDataFile(
  schemaDir: FileSystemDirectoryHandle,
  tableName: string,
): Promise<void> {
  return removeEntry(schemaDir, `${tableName}.json`)
}

/** 旧结构 output/ 目录句柄 */
export function getOutputDir(
  root: FileSystemDirectoryHandle,
  create = true,
): Promise<FileSystemDirectoryHandle> {
  return getOrCreateDir(root, OUTPUT_DIR, create)
}

/** 旧结构 output/<dialect>/ 目录句柄 */
export function getOutputDialectDir(
  outputDir: FileSystemDirectoryHandle,
  dialect: string,
  create = true,
): Promise<FileSystemDirectoryHandle> {
  return getOrCreateDir(outputDir, dialect, create)
}

/** 旧结构 output/<dialect>/<filename>.sql 文件句柄 */
export function getOutputSqlFileHandle(
  dialectDir: FileSystemDirectoryHandle,
  filename: string,
): Promise<FileSystemFileHandle> {
  return getFileHandleSafe(dialectDir, filename)
}

/** 删除旧结构 output/<dialect>/<filename>.sql */
export function removeOutputSqlFile(
  dialectDir: FileSystemDirectoryHandle,
  filename: string,
): Promise<void> {
  return removeEntry(dialectDir, filename)
}

// ===== 新结构（current/baselines/migrations）路径解析 =====

/** current/ 目录句柄 */
export function getCurrentDir(
  root: FileSystemDirectoryHandle,
  create = true,
): Promise<FileSystemDirectoryHandle> {
  return getOrCreateDir(root, CURRENT_DIR, create)
}

/** current/database.json 文件句柄 */
export function getCurrentDatabaseFileHandle(
  currentDir: FileSystemDirectoryHandle,
  create = true,
): Promise<FileSystemFileHandle> {
  return getFileHandleSafe(currentDir, DATABASE_FILE, create)
}

/** current/schemas/ 目录句柄 */
export function getCurrentSchemasDir(
  currentDir: FileSystemDirectoryHandle,
  create = true,
): Promise<FileSystemDirectoryHandle> {
  return getOrCreateDir(currentDir, SCHEMAS_DIR, create)
}

/** current/schemas/<schemaName>/ 目录句柄 */
export function getSchemaDirUnderCurrent(
  schemasDir: FileSystemDirectoryHandle,
  schemaName: string,
  create = true,
): Promise<FileSystemDirectoryHandle> {
  return getOrCreateDir(schemasDir, schemaName, create)
}

/** current/schemas/<schemaName>/<tableName>/ 目录句柄 */
export function getTableDirUnderSchema(
  schemaDir: FileSystemDirectoryHandle,
  tableName: string,
  create = true,
): Promise<FileSystemDirectoryHandle> {
  return getOrCreateDir(schemaDir, tableName, create)
}

/** table.json 文件句柄（位于 table 目录下） */
export function getTableFileHandle(
  tableDir: FileSystemDirectoryHandle,
  create = true,
): Promise<FileSystemFileHandle> {
  return getFileHandleSafe(tableDir, TABLE_FILE, create)
}

/** initial-data.json 文件句柄（位于 table 目录下） */
export function getInitialDataFileHandle(
  tableDir: FileSystemDirectoryHandle,
  create = true,
): Promise<FileSystemFileHandle> {
  return getFileHandleSafe(tableDir, INITIAL_DATA_FILE, create)
}

/** baselines/ 目录句柄 */
export function getBaselinesDir(
  root: FileSystemDirectoryHandle,
  create = true,
): Promise<FileSystemDirectoryHandle> {
  return getOrCreateDir(root, BASELINES_DIR, create)
}

/** baselines/<id>.json 文件句柄 */
export function getBaselineFileHandle(
  baselinesDir: FileSystemDirectoryHandle,
  id: string,
  create = true,
): Promise<FileSystemFileHandle> {
  return getFileHandleSafe(baselinesDir, `${id}.json`, create)
}

/** migrations/ 目录句柄 */
export function getMigrationsDir(
  root: FileSystemDirectoryHandle,
  create = true,
): Promise<FileSystemDirectoryHandle> {
  return getOrCreateDir(root, MIGRATIONS_DIR, create)
}

/** migrations/<id>.json 文件句柄 */
export function getMigrationFileHandle(
  migrationsDir: FileSystemDirectoryHandle,
  id: string,
  create = true,
): Promise<FileSystemFileHandle> {
  return getFileHandleSafe(migrationsDir, `${id}.json`, create)
}
