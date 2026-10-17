import type { Ref } from 'vue'
import type { CommonConfig, Schema, InitialData } from '@/types/schema'
import { newVersionId, newMigrationId, newEnvironmentId } from '@/core/ids'
import { computeStructureDiff } from '@/core/version/diff'
import { buildRenameLookup, buildRenameMap, suggestRenames } from '@/core/version/identity'
import type { RenameSuggestion } from '@/core/version/identity'
import type {
  VersionSummary,
  VersionSnapshot,
  Migration,
  MigrationDdlPreview,
  RenameEntry,
  StructureDiff,
  Environment,
} from '@/core/version/types'
import { generateMigrationDdl } from '@/core/version/migration-ddl'
import { CURRENT_STRUCT_VERSION, VERSIONS_DIR, MIGRATIONS_DIR, ENVIRONMENTS_DIR } from '@/core/workspace/layout'
import type { FileChange } from '@/core/workspace/save-coordinator'
import { jsonContent } from '@/core/workspace/project-documents'
import { buildCommonWriteData } from '@/core/workspace/serialization'

export interface VersionDeps {
  getDocuments: () => {
    readonly files: ReadonlyMap<string, string>
    update(changes: readonly FileChange[]): void
  } | null
  versions: Ref<VersionSummary[]>
  migrations: Ref<Migration[]>
  environments: Ref<Environment[]>
  versionPreviewLoading: Ref<boolean>
  selectedVersionSnapshot: Ref<VersionSnapshot | null>
  commonConfig: Ref<CommonConfig | null>
  schemas: Schema[]
  initialDataMap: Map<string, InitialData>
  showToast: (msg: string) => void
  t: (key: string, options?: Record<string, unknown>) => string
}

type Documents = NonNullable<ReturnType<VersionDeps['getDocuments']>>
type Decoder<T> = (value: unknown) => T | null
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isString = (value: unknown): value is string => typeof value === 'string'
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString)
const hasMetadata = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && isString(value.id) && value.id.length > 0
  && isString(value.name) && isString(value.created_at) && value.created_at.length > 0

// Check the shapes used by lists, diff and DDL without rewriting malformed raw documents.
const decodeVersion: Decoder<VersionSnapshot> = value => {
  if (!hasMetadata(value) || !isString(value.struct_version)
    || (value.parent_id !== undefined && !isString(value.parent_id))
    || !isStringArray(value.schema_order) || !isRecord(value.initial_data)
    || (value.common !== null && !isRecord(value.common))
    || !Array.isArray(value.schemas)) return null
  for (const schema of value.schemas) {
    if (!isRecord(schema) || !isString(schema.schema) || !Array.isArray(schema.tables)) return null
    for (const table of schema.tables) {
      if (!isRecord(table) || !isString(table.name)
        || !Array.isArray(table.fields) || !Array.isArray(table.indexes)
        || !table.fields.every(field => isRecord(field) && isString(field.field_name))
        || !table.indexes.every(index => isRecord(index) && isString(index.type)
          && Array.isArray(index.columns) && index.columns.every(column => isRecord(column) && isString(column.name)))) return null
    }
  }
  return value as unknown as VersionSnapshot
}

const decodeMigration: Decoder<Migration> = value => {
  if (!hasMetadata(value) || !isString(value.from_version) || !isString(value.to_version)
    || !isString(value.updated_at) || !Array.isArray(value.steps)
    || (value.note !== undefined && !isString(value.note))) return null
  // Older migrations did not contain renames. Normalize in memory only.
  const renames = value.renames ?? []
  if (!Array.isArray(renames) || !renames.every(rename => isRecord(rename)
    && ['schema', 'table', 'field', 'index'].includes(String(rename.kind))
    && isString(rename.from) && isString(rename.to)
    && ['editor', 'auto', 'manual'].includes(String(rename.source)))) return null
  for (const step of value.steps) {
    if (!isRecord(step)) return null
    switch (step.type) {
      case 'auto_diff':
        if (step.only_tables !== undefined && !isStringArray(step.only_tables)) return null
        break
      case 'clear_column':
        if (![step.schema, step.table, step.column].every(isString)) return null
        break
      case 'sql_transform':
      case 'custom_sql':
        if (![step.mysql, step.postgresql, step.sqlite].every(sql => sql === undefined || isString(sql))) return null
        break
      default:
        return null
    }
  }
  if (value.env_status !== undefined && (!isRecord(value.env_status)
    || !Object.values(value.env_status).every(status => isRecord(status) && typeof status.executed === 'boolean'
      && (status.executed_at === undefined || isString(status.executed_at))
      && (status.note === undefined || isString(status.note))))) return null
  return { ...value, renames } as unknown as Migration
}

const decodeEnvironment: Decoder<Environment> = value => {
  if (!hasMetadata(value) || !isString(value.version_id) || !isString(value.updated_at)
    || (value.note !== undefined && !isString(value.note))) return null
  return value as unknown as Environment
}

function documentPath(directory: string, id: string): string | null {
  return id && !/[/\\]/.test(id) && id !== '.' && id !== '..' ? `${directory}/${id}.json` : null
}

function readDocument<T extends { id: string }>(documents: Documents, directory: string, id: string, decode: Decoder<T>): T | null {
  const path = documentPath(directory, id)
  const content = path ? documents.files.get(path) : undefined
  if (content === undefined) return null
  try {
    const value = decode(JSON.parse(content))
    return value?.id === id ? value : null
  } catch {
    return null
  }
}

function listDocuments<T extends { id: string; created_at: string }>(documents: Documents, directory: string, decode: Decoder<T>): T[] {
  const result: T[] = []
  const prefix = `${directory}/`
  for (const path of documents.files.keys()) {
    if (!path.startsWith(prefix) || !path.endsWith('.json')) continue
    const id = path.slice(prefix.length, -5)
    if (documentPath(directory, id) !== path) continue
    const value = readDocument(documents, directory, id, decode)
    if (value) result.push(value)
  }
  return result.sort((a, b) => a.created_at.localeCompare(b.created_at))
}

function stageDocument<T extends { id: string }>(documents: Documents, directory: string, value: T, decode: Decoder<T>, create = false): T {
  const path = documentPath(directory, value.id)
  if (!path) throw new Error('Invalid document id')
  if (documents.files.has(path) && (create || !readDocument(documents, directory, value.id, decode))) {
    throw new Error(`Cannot overwrite existing document: ${path}`)
  }
  const content = jsonContent(value)
  const stored = decode(JSON.parse(content))
  if (!stored) throw new Error(`Invalid document: ${path}`)
  documents.update([{ path, content }])
  return stored
}

function removeDocument(documents: Documents, directory: string, id: string): void {
  const path = documentPath(directory, id)
  if (path && documents.files.has(path)) documents.update([{ path, content: null }])
}

function versionSummary(snapshot: VersionSnapshot): VersionSummary {
  const { id, name, created_at, parent_id } = snapshot
  return { id, name, created_at, ...(parent_id ? { parent_id } : {}) }
}

function listVersionSummaries(documents: Documents): VersionSummary[] {
  return listDocuments(documents, VERSIONS_DIR, decodeVersion).map(versionSummary)
}

export function createVersionActions(deps: VersionDeps) {
  const {
    getDocuments,
    versions,
    migrations,
    environments,
    versionPreviewLoading,
    selectedVersionSnapshot,
    commonConfig,
    schemas,
    initialDataMap,
    showToast,
    t,
  } = deps

  // Public APIs remain async for callers, but all reads/staging finish before yielding.
  // Each action captures one document session; it never resumes against another project.
  async function loadVersionsAndMigrations() {
    const documents = getDocuments()
    if (!documents) return
    versions.value = listVersionSummaries(documents)
    migrations.value = listDocuments(documents, MIGRATIONS_DIR, decodeMigration)
    environments.value = listDocuments(documents, ENVIRONMENTS_DIR, decodeEnvironment)
  }

  /** 将当前内存态序列化为不可变的版本文档，保存时才写入磁盘。 */
  async function createVersion(name?: string): Promise<VersionSummary | null> {
    const documents = getDocuments()
    if (!documents) return null
    try {
      const existing = listVersionSummaries(documents)
      const id = newVersionId()
      const displayName = name?.trim() || `v${existing.length + 1}.0`
      const parentId = existing.at(-1)?.id
      const snapshot = stageDocument<VersionSnapshot>(documents, VERSIONS_DIR, {
        id,
        name: displayName,
        created_at: new Date().toISOString(),
        struct_version: CURRENT_STRUCT_VERSION,
        ...(parentId ? { parent_id: parentId } : {}),
        common: buildCommonWriteData(commonConfig.value) as CommonConfig,
        schema_order: schemas.map(schema => schema.schema),
        initial_data: Object.fromEntries(initialDataMap),
        schemas,
      }, decodeVersion, true)
      versions.value = [...existing, versionSummary(snapshot)]
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
      showToast(t('version.created', { name: displayName }))
      return versionSummary(snapshot)
    } catch (e) {
      console.error('[createVersion] failed:', e)
      showToast(t('toast.failedSaveChanges'))
      return null
    }
  }

  /** 仅修改暂存快照的 name，并立即同步列表和预览缓存。 */
  async function renameVersion(id: string, name: string): Promise<void> {
    const documents = getDocuments()
    if (!documents) return
    const displayName = name.trim()
    if (!displayName) return
    const snapshot = readDocument(documents, VERSIONS_DIR, id, decodeVersion)
    if (!snapshot || displayName === snapshot.name) return
    try {
      snapshot.name = displayName
      const stored = stageDocument(documents, VERSIONS_DIR, snapshot, decodeVersion)
      versions.value = listVersionSummaries(documents)
      if (selectedVersionSnapshot.value?.id === id) selectedVersionSnapshot.value = stored
      showToast(t('version.renamed', { name: displayName }))
    } catch (e) {
      console.error('[renameVersion] failed:', e)
      showToast(t('toast.failedSaveChanges'))
    }
  }

  async function deleteVersionById(id: string): Promise<void> {
    const documents = getDocuments()
    if (!documents) return
    try {
      removeDocument(documents, VERSIONS_DIR, id)
      versions.value = listVersionSummaries(documents)
      if (selectedVersionSnapshot.value?.id === id) selectedVersionSnapshot.value = null
    } catch (e) {
      console.error('[deleteVersionById] failed:', e)
    }
  }

  async function getVersionSnapshot(id: string): Promise<VersionSnapshot | null> {
    const documents = getDocuments()
    return documents ? readDocument(documents, VERSIONS_DIR, id, decodeVersion) : null
  }

  async function previewVersionById(id: string): Promise<void> {
    const documents = getDocuments()
    if (!documents) return
    versionPreviewLoading.value = true
    try {
      selectedVersionSnapshot.value = readDocument(documents, VERSIONS_DIR, id, decodeVersion)
    } finally {
      versionPreviewLoading.value = false
    }
  }

  function clearVersionPreview(): void {
    selectedVersionSnapshot.value = null
  }

  /** 历史改名事实同样取自暂存文档，而不是调用方可能正在编辑的缓存。 */
  function buildLookup(documents: Documents): ReturnType<typeof buildRenameLookup> {
    const entries: RenameEntry[] = listDocuments(documents, MIGRATIONS_DIR, decodeMigration)
      .flatMap(migration => migration.renames)
    return buildRenameLookup(buildRenameMap(entries).map)
  }

  function loadDiffSides(documents: Documents, fromId: string | null, toId: string | null, toCurrent: boolean) {
    const from = fromId === null ? null : readDocument(documents, VERSIONS_DIR, fromId, decodeVersion)
    // Only an explicitly null source means the empty structure, never an unreadable version.
    if (fromId !== null && !from) return null
    const to = toCurrent || toId === null ? null : readDocument(documents, VERSIONS_DIR, toId, decodeVersion)
    if (!toCurrent && !to) return null
    const fromRef: StructureDiff['from'] = from ? { kind: 'version', id: from.id, name: from.name } : null
    const toRef: StructureDiff['to'] = to ? { kind: 'version', id: to.id, name: to.name } : { kind: 'current' }
    return {
      fromSchemas: from?.schemas ?? null,
      toSchemas: to ? to.schemas : clone(schemas),
      toCommon: to ? to.common : clone(commonConfig.value),
      fromRef,
      toRef,
    }
  }

  /** fromId 为 null 时才与空结构对比；toCurrent 时目标取当前内存态。 */
  async function computeDiff(fromId: string | null, toId: string | null, toCurrent: boolean): Promise<StructureDiff | null> {
    const documents = getDocuments()
    if (!documents) return null
    const sides = loadDiffSides(documents, fromId, toId, toCurrent)
    if (!sides) return null
    return computeStructureDiff(sides.fromSchemas, sides.toSchemas, sides.fromRef, sides.toRef, buildLookup(documents))
  }

  async function suggestRenameEntries(fromId: string | null, toId: string | null, toCurrent: boolean): Promise<RenameSuggestion[]> {
    const documents = getDocuments()
    if (!documents) return []
    const sides = loadDiffSides(documents, fromId, toId, toCurrent)
    if (!sides?.fromSchemas) return []
    return suggestRenames(sides.fromSchemas, sides.toSchemas)
  }

  // ===== Migrations =====

  async function createMigration(fromVersion: string, toVersion: string, name?: string): Promise<Migration | null> {
    const documents = getDocuments()
    if (!documents) return null
    const from = readDocument(documents, VERSIONS_DIR, fromVersion, decodeVersion)
    const to = readDocument(documents, VERSIONS_DIR, toVersion, decodeVersion)
    if (!from || !to) return null
    try {
      const now = new Date().toISOString()
      const migration = stageDocument<Migration>(documents, MIGRATIONS_DIR, {
        id: newMigrationId(),
        name: name?.trim() || `${from.name} → ${to.name}`,
        from_version: fromVersion,
        to_version: toVersion,
        renames: [],
        steps: [{ type: 'auto_diff' }],
        created_at: now,
        updated_at: now,
      }, decodeMigration, true)
      migrations.value = listDocuments(documents, MIGRATIONS_DIR, decodeMigration)
      showToast(t('migration.created', { name: migration.name }))
      return migration
    } catch (e) {
      console.error('[createMigration] failed:', e)
      showToast(t('toast.failedSaveChanges'))
      return null
    }
  }

  async function updateMigration(migration: Migration): Promise<void> {
    const documents = getDocuments()
    if (!documents) return
    try {
      stageDocument(documents, MIGRATIONS_DIR, { ...migration, updated_at: new Date().toISOString() }, decodeMigration)
      migrations.value = listDocuments(documents, MIGRATIONS_DIR, decodeMigration)
    } catch (e) {
      console.error('[updateMigration] failed:', e)
      showToast(t('toast.failedSaveChanges'))
    }
  }

  async function deleteMigrationById(id: string): Promise<void> {
    const documents = getDocuments()
    if (!documents) return
    try {
      removeDocument(documents, MIGRATIONS_DIR, id)
      migrations.value = listDocuments(documents, MIGRATIONS_DIR, decodeMigration)
    } catch (e) {
      console.error('[deleteMigrationById] failed:', e)
    }
  }

  // ===== Environments =====

  async function createEnvironment(name: string, versionId: string, note?: string): Promise<Environment | null> {
    const documents = getDocuments()
    if (!documents) return null
    const existing = listDocuments(documents, ENVIRONMENTS_DIR, decodeEnvironment)
    const displayName = name?.trim() || t('environment.defaultName', { n: existing.length + 1 })
    try {
      const now = new Date().toISOString()
      const environment = stageDocument<Environment>(documents, ENVIRONMENTS_DIR, {
        id: newEnvironmentId(),
        name: displayName,
        version_id: versionId,
        ...(note?.trim() ? { note: note.trim() } : {}),
        created_at: now,
        updated_at: now,
      }, decodeEnvironment, true)
      environments.value = listDocuments(documents, ENVIRONMENTS_DIR, decodeEnvironment)
      showToast(t('environment.created', { name: displayName }))
      return environment
    } catch (e) {
      console.error('[createEnvironment] failed:', e)
      showToast(t('toast.failedSaveChanges'))
      return null
    }
  }

  async function updateEnvironment(environment: Environment): Promise<void> {
    const documents = getDocuments()
    if (!documents) return
    try {
      const stored = stageDocument(documents, ENVIRONMENTS_DIR, { ...environment, updated_at: new Date().toISOString() }, decodeEnvironment)
      environments.value = listDocuments(documents, ENVIRONMENTS_DIR, decodeEnvironment)
      showToast(t('environment.saved', { name: stored.name }))
    } catch (e) {
      console.error('[updateEnvironment] failed:', e)
      showToast(t('toast.failedSaveChanges'))
    }
  }

  async function deleteEnvironmentById(id: string): Promise<void> {
    const documents = getDocuments()
    if (!documents) return
    try {
      removeDocument(documents, ENVIRONMENTS_DIR, id)
      environments.value = listDocuments(documents, ENVIRONMENTS_DIR, decodeEnvironment)
    } catch (e) {
      console.error('[deleteEnvironmentById] failed:', e)
    }
  }

  /** 两个版本和目标 common 均来自同一暂存会话，不依赖当前工作区配置。 */
  async function previewMigrationDdl(migration: Migration): Promise<MigrationDdlPreview | null> {
    const documents = getDocuments()
    if (!documents) return null
    const sides = loadDiffSides(documents, migration.from_version, migration.to_version, false)
    if (!sides) return null
    const diff = computeStructureDiff(sides.fromSchemas, sides.toSchemas, sides.fromRef, sides.toRef, buildLookup(documents))
    return generateMigrationDdl(clone(migration), diff, sides.toSchemas, sides.toCommon)
  }

  return {
    loadVersionsAndMigrations,
    createVersion,
    renameVersion,
    deleteVersionById,
    getVersionSnapshot,
    previewVersionById,
    clearVersionPreview,
    computeDiff,
    suggestRenameEntries,
    createMigration,
    updateMigration,
    deleteMigrationById,
    previewMigrationDdl,
    createEnvironment,
    updateEnvironment,
    deleteEnvironmentById,
  }
}
