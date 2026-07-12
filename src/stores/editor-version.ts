import type { Ref, ComputedRef } from 'vue'
import type { CommonConfig, Schema } from '@/types/schema'
import type { InitialData } from '@/types/schema'
import { newVersionId, newMigrationId, newSchemaId, newTableId, newFieldId, newIndexId, newInitialDataId } from '@/core/ids'
import {
  listVersions,
  readVersion,
  writeVersion,
  deleteVersion,
} from '@/core/version/storage'
import { computeStructureDiff } from '@/core/version/diff'
import type {
  VersionSummary,
  VersionSnapshot,
  Migration,
  MigrationDdlPreview,
  StructureDiff,
} from '@/core/version/types'
import {
  listMigrations,
  readMigration,
  writeMigration,
  deleteMigration,
} from '@/core/version/migration-storage'
import { generateMigrationDdl } from '@/core/version/migration-ddl'
import { CURRENT_STRUCT_VERSION } from '@/core/workspace/layout'

export interface VersionDeps {
  rootDirHandle: Ref<any>
  versions: Ref<VersionSummary[]>
  migrations: Ref<Migration[]>
  versionPreviewLoading: Ref<boolean>
  selectedVersionSnapshot: Ref<VersionSnapshot | null>
  commonConfig: Ref<CommonConfig | null>
  schemas: Schema[]
  initialDataMap: Map<string, InitialData>
  syncAllToDisk: () => Promise<void>
  showToast: (msg: string) => void
  t: (key: string, options?: any) => string
}

export function createVersionActions(deps: VersionDeps) {
  const {
    rootDirHandle,
    versions,
    migrations,
    versionPreviewLoading,
    selectedVersionSnapshot,
    commonConfig,
    schemas,
    initialDataMap,
    syncAllToDisk,
    showToast,
    t,
  } = deps

  // ===== Versions / Migrations =====

  /** 加载版本列表与迁移脚本列表（仅元数据） */
  async function loadVersionsAndMigrations() {
    if (!rootDirHandle.value) return
    try {
      versions.value = await listVersions(rootDirHandle.value)
    } catch (e) {
      console.error('[loadVersionsAndMigrations] versions failed:', e)
      versions.value = []
    }
    try {
      migrations.value = await listMigrations(rootDirHandle.value)
    } catch (e) {
      console.error('[loadVersionsAndMigrations] migrations failed:', e)
      migrations.value = []
    }
  }

  /**
   * 为当前内存态补齐缺失的唯一 id（field_id / table_id / schema_id / index_id / initial_data_id）。
   * 无论是否已创建版本都会在加载或创建版本时调用，保证所有对象都带 id 以跨版本识别 rename。
   * 返回是否发生了补齐（用于决定是否需写盘）。
   */
  function ensureIdsForCurrent(): boolean {
    let changed = false
    for (const schema of schemas) {
      if (!schema.schema_id) {
        schema.schema_id = newSchemaId()
        changed = true
      }
      for (const table of schema.tables) {
        if (!table.table_id) {
          table.table_id = newTableId()
          changed = true
        }
        for (const field of table.fields) {
          if (!field.field_id) {
            field.field_id = newFieldId()
            changed = true
          }
        }
        for (const index of table.indexes) {
          if (!index.index_id) {
            index.index_id = newIndexId()
            changed = true
          }
        }
      }
    }
    for (const data of initialDataMap.values()) {
      if (data.rows) {
        for (const row of data.rows) {
          if (!row.initial_data_id) {
            row.initial_data_id = newInitialDataId()
            changed = true
          }
        }
      }
    }
    return changed
  }

  /**
   * 创建版本：
   * 1. 若当前内存态存在缺失 id，先补齐（保证版本快照可跨版本识别 rename）。
   * 2. 将补齐后的 current 深拷贝快照为 versions/<id>.json。
   * 3. 刷新版本列表。
   * 创建后用户进入「有版本」状态，后续新增表/字段自动带 id。
   */
  async function createVersion(name?: string): Promise<VersionSummary | null> {
    if (!rootDirHandle.value) return null
    const id = newVersionId()
    const displayName = name?.trim() || `v${versions.value.length + 1}.0`

    // 补齐缺失 id（若有变化，先写回 current/ 磁盘，保证快照与 current 一致）
    if (ensureIdsForCurrent()) {
      await syncAllToDisk()
    }

    const snapshot: VersionSnapshot = {
      id,
      name: displayName,
      created_at: new Date().toISOString(),
      struct_version: CURRENT_STRUCT_VERSION,
      common: JSON.parse(JSON.stringify(commonConfig.value)),
      schema_order: commonConfig.value?.schema_order ?? schemas.map(s => s.schema),
      initial_data: JSON.parse(JSON.stringify(Object.fromEntries(initialDataMap.entries()))),
      schemas: JSON.parse(JSON.stringify(schemas)),
    }

    try {
      await writeVersion(rootDirHandle.value, snapshot)
      await loadVersionsAndMigrations()
      showToast(t('version.created', { name: displayName }))
      return { id, name: displayName, created_at: snapshot.created_at }
    } catch (e) {
      console.error('[createVersion] failed:', e)
      showToast(t('toast.failedSaveChanges'))
      return null
    }
  }

  /** 删除版本 */
  async function deleteVersionById(id: string): Promise<void> {
    if (!rootDirHandle.value) return
    try {
      await deleteVersion(rootDirHandle.value, id)
      await loadVersionsAndMigrations()
    } catch (e) {
      console.error('[deleteVersionById] failed:', e)
    }
  }

  /** 读取版本完整快照（供 diff / 迁移使用） */
  async function getVersionSnapshot(id: string): Promise<VersionSnapshot | null> {
    if (!rootDirHandle.value) return null
    return readVersion(rootDirHandle.value, id)
  }

  /** 预览版本：加载完整快照到预览面板 */
  async function previewVersionById(id: string): Promise<void> {
    if (!rootDirHandle.value) return
    versionPreviewLoading.value = true
    try {
      selectedVersionSnapshot.value = await readVersion(rootDirHandle.value, id)
    } catch (e) {
      console.error('[previewVersionById] failed:', e)
      selectedVersionSnapshot.value = null
    } finally {
      versionPreviewLoading.value = false
    }
  }

  /** 关闭版本预览 */
  function clearVersionPreview(): void {
    selectedVersionSnapshot.value = null
  }

  /**
   * 计算两版本（或 当前 vs 版本）之间的结构 diff。
   * @param fromId 源版本 id；为 null 表示与「空结构」对比（即首次全量）
   * @param toCurrent true 时目标取当前内存态；否则取 toId 版本
   */
  async function computeDiff(
    fromId: string | null,
    toId: string | null,
    toCurrent: boolean,
  ): Promise<StructureDiff | null> {
    if (!rootDirHandle.value) return null
    let fromSchemas: import('@/types/schema').Schema[] | null = null
    if (fromId) {
      const fromSnap = await readVersion(rootDirHandle.value, fromId)
      fromSchemas = fromSnap?.schemas ?? null
    }
    let toSchemas: import('@/types/schema').Schema[]
    let toRef: StructureDiff['to']
    if (toCurrent) {
      toSchemas = JSON.parse(JSON.stringify(schemas))
      toRef = { kind: 'current' }
    } else if (toId) {
      const toSnap = await readVersion(rootDirHandle.value, toId)
      toSchemas = toSnap?.schemas ?? []
      toRef = { kind: 'version', id: toId, name: toSnap?.name ?? toId }
    } else {
      return null
    }
    const fromRef: StructureDiff['from'] = fromId
      ? { kind: 'version', id: fromId, name: versions.value.find(b => b.id === fromId)?.name ?? fromId }
      : null
    return computeStructureDiff(fromSchemas, toSchemas, fromRef, toRef)
  }

  // ===== Migrations =====

  /** 创建迁移脚本（选两版本），默认带一个 auto_diff 步骤 */
  async function createMigration(fromVersion: string, toVersion: string, name?: string): Promise<Migration | null> {
    if (!rootDirHandle.value) return null
    const id = newMigrationId()
    const fromName = versions.value.find(b => b.id === fromVersion)?.name ?? fromVersion
    const toName = versions.value.find(b => b.id === toVersion)?.name ?? toVersion
    const migration: Migration = {
      id,
      name: name?.trim() || `${fromName} → ${toName}`,
      from_version: fromVersion,
      to_version: toVersion,
      steps: [{ type: 'auto_diff' }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    try {
      await writeMigration(rootDirHandle.value, migration)
      await loadVersionsAndMigrations()
      showToast(t('migration.created', { name: migration.name }))
      return migration
    } catch (e) {
      console.error('[createMigration] failed:', e)
      showToast(t('toast.failedSaveChanges'))
      return null
    }
  }

  /** 更新迁移脚本（持久化 steps 等） */
  async function updateMigration(migration: Migration): Promise<void> {
    if (!rootDirHandle.value) return
    migration.updated_at = new Date().toISOString()
    try {
      await writeMigration(rootDirHandle.value, migration)
      // 刷新缓存（保留引用顺序）
      const idx = migrations.value.findIndex(m => m.id === migration.id)
      if (idx >= 0) migrations.value[idx] = migration
      else migrations.value.push(migration)
    } catch (e) {
      console.error('[updateMigration] failed:', e)
      showToast(t('toast.failedSaveChanges'))
    }
  }

  async function deleteMigrationById(id: string): Promise<void> {
    if (!rootDirHandle.value) return
    try {
      await deleteMigration(rootDirHandle.value, id)
      await loadVersionsAndMigrations()
    } catch (e) {
      console.error('[deleteMigrationById] failed:', e)
    }
  }

  /** 预览迁移脚本合并后的最终 DDL（两方言） */
  async function previewMigrationDdl(migration: Migration): Promise<MigrationDdlPreview | null> {
    if (!rootDirHandle.value) return null
    const diff = await computeDiff(migration.from_version, migration.to_version, false)
    if (!diff) return null
    const targetSnap = await readVersion(rootDirHandle.value, migration.to_version)
    const targetSchemas = targetSnap?.schemas ?? []
    return generateMigrationDdl(migration, diff, targetSchemas, commonConfig.value)
  }

  return {
    loadVersionsAndMigrations,
    ensureIdsForCurrent,
    createVersion,
    deleteVersionById,
    getVersionSnapshot,
    previewVersionById,
    clearVersionPreview,
    computeDiff,
    createMigration,
    updateMigration,
    deleteMigrationById,
    previewMigrationDdl,
  }
}
