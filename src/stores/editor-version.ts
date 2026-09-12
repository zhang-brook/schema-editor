import type { Ref, ComputedRef } from 'vue'
import type { CommonConfig, Schema } from '@/types/schema'
import type { InitialData } from '@/types/schema'
import { newVersionId, newMigrationId, newEnvironmentId } from '@/core/ids'
import { listVersions, readVersion, writeVersion, deleteVersion } from '@/core/version/storage'
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
} from '@/core/version/types'
import {
  listMigrations,
  readMigration,
  writeMigration,
  deleteMigration,
} from '@/core/version/migration-storage'
import {
  listEnvironments,
  writeEnvironment,
  deleteEnvironment,
} from '@/core/version/environment-storage'
import type { Environment } from '@/core/version/types'
import { generateMigrationDdl } from '@/core/version/migration-ddl'
import { CURRENT_STRUCT_VERSION } from '@/core/workspace/layout'

export interface VersionDeps {
  rootDirHandle: Ref<any>
  versions: Ref<VersionSummary[]>
  migrations: Ref<Migration[]>
  environments: Ref<Environment[]>
  versionPreviewLoading: Ref<boolean>
  selectedVersionSnapshot: Ref<VersionSnapshot | null>
  commonConfig: Ref<CommonConfig | null>
  schemas: Schema[]
  initialDataMap: Map<string, InitialData>
  showToast: (msg: string) => void
  t: (key: string, options?: any) => string
}

export function createVersionActions(deps: VersionDeps) {
  const {
    rootDirHandle,
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
    try {
      environments.value = await listEnvironments(rootDirHandle.value)
    } catch (e) {
      console.error('[loadVersionsAndMigrations] environments failed:', e)
      environments.value = []
    }
  }

  /**
   * 创建版本：将当前内存态深拷贝快照为 versions/<id>.json 并刷新版本列表。
   * 结构对象本身不携带 id，跨版本识别 rename 依赖迁移脚本上累积的改名记录。
   */
  async function createVersion(name?: string): Promise<VersionSummary | null> {
    if (!rootDirHandle.value) return null
    const id = newVersionId()
    const displayName = name?.trim() || `v${versions.value.length + 1}.0`
    // 基线取时间上最新的已有版本，使版本串成链
    const parentId = [...versions.value]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .at(-1)?.id

    const snapshot: VersionSnapshot = {
      id,
      name: displayName,
      created_at: new Date().toISOString(),
      struct_version: CURRENT_STRUCT_VERSION,
      ...(parentId ? { parent_id: parentId } : {}),
      common: JSON.parse(JSON.stringify(commonConfig.value)),
      schema_order: commonConfig.value?.schema_order ?? schemas.map((s) => s.schema),
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

  /** 重命名版本：仅改 name 并持久化快照，同步刷新列表缓存 */
  async function renameVersion(id: string, name: string): Promise<void> {
    if (!rootDirHandle.value) return
    const displayName = name.trim()
    if (!displayName) return
    const snap = await readVersion(rootDirHandle.value, id)
    if (!snap) return
    if (displayName === snap.name) return
    snap.name = displayName
    try {
      await writeVersion(rootDirHandle.value, snap)
      const idx = versions.value.findIndex((v) => v.id === id)
      if (idx >= 0) {
        const cur = versions.value[idx]!
        versions.value[idx] = { ...cur, name: displayName }
      }
      showToast(t('version.renamed', { name: displayName }))
    } catch (e) {
      console.error('[renameVersion] failed:', e)
      showToast(t('toast.failedSaveChanges'))
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

  /** 汇总所有迁移上记录的改名事实（跨迁移复用，配合传递闭包可跨版本识别） */
  function collectRenameEntries(): RenameEntry[] {
    const out: RenameEntry[] = []
    for (const m of migrations.value) {
      if (Array.isArray(m.renames)) out.push(...m.renames)
    }
    return out
  }

  /** 由历史改名事实构造反查表，供 diff 匹配使用 */
  function buildLookup(): ReturnType<typeof buildRenameLookup> {
    return buildRenameLookup(buildRenameMap(collectRenameEntries()).map)
  }

  /** 读取 diff 的源/目标两侧结构 */
  async function loadDiffSides(
    fromId: string | null,
    toId: string | null,
    toCurrent: boolean,
  ): Promise<{
    fromSchemas: import('@/types/schema').Schema[] | null
    toSchemas: import('@/types/schema').Schema[]
    fromRef: StructureDiff['from']
    toRef: StructureDiff['to']
  } | null> {
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
      ? {
          kind: 'version',
          id: fromId,
          name: versions.value.find((b) => b.id === fromId)?.name ?? fromId,
        }
      : null
    return { fromSchemas, toSchemas, fromRef, toRef }
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
    const sides = await loadDiffSides(fromId, toId, toCurrent)
    if (!sides) return null
    return computeStructureDiff(
      sides.fromSchemas,
      sides.toSchemas,
      sides.fromRef,
      sides.toRef,
      buildLookup(),
    )
  }

  /**
   * 推断两版本之间的改名候选。
   * 仅在缺少改名记录时作为补充手段，结论需经用户确认后写入迁移的 renames 才生效。
   */
  async function suggestRenameEntries(
    fromId: string | null,
    toId: string | null,
    toCurrent: boolean,
  ): Promise<RenameSuggestion[]> {
    const sides = await loadDiffSides(fromId, toId, toCurrent)
    if (!sides || !sides.fromSchemas) return []
    return suggestRenames(sides.fromSchemas, sides.toSchemas)
  }

  // ===== Migrations =====

  /** 创建迁移脚本（选两版本），默认带一个 auto_diff 步骤 */
  async function createMigration(
    fromVersion: string,
    toVersion: string,
    name?: string,
  ): Promise<Migration | null> {
    if (!rootDirHandle.value) return null
    const id = newMigrationId()
    const fromName = versions.value.find((b) => b.id === fromVersion)?.name ?? fromVersion
    const toName = versions.value.find((b) => b.id === toVersion)?.name ?? toVersion
    const migration: Migration = {
      id,
      name: name?.trim() || `${fromName} → ${toName}`,
      from_version: fromVersion,
      to_version: toVersion,
      renames: [],
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
      const idx = migrations.value.findIndex((m) => m.id === migration.id)
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

  // ===== Environments =====

  /** 创建环境，关联到指定版本 */
  async function createEnvironment(
    name: string,
    versionId: string,
    note?: string,
  ): Promise<Environment | null> {
    if (!rootDirHandle.value) return null
    const displayName = name?.trim() || t('environment.defaultName', { n: environments.value.length + 1 })
    const env: Environment = {
      id: newEnvironmentId(),
      name: displayName,
      version_id: versionId,
      ...(note?.trim() ? { note: note.trim() } : {}),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    try {
      await writeEnvironment(rootDirHandle.value, env)
      await loadVersionsAndMigrations()
      showToast(t('environment.created', { name: displayName }))
      return env
    } catch (e) {
      console.error('[createEnvironment] failed:', e)
      showToast(t('toast.failedSaveChanges'))
      return null
    }
  }

  /** 更新环境（名称 / 关联版本 / 备注） */
  async function updateEnvironment(env: Environment): Promise<void> {
    if (!rootDirHandle.value) return
    env.updated_at = new Date().toISOString()
    try {
      await writeEnvironment(rootDirHandle.value, env)
      const idx = environments.value.findIndex(e => e.id === env.id)
      if (idx >= 0) environments.value[idx] = env
      else environments.value.push(env)
    } catch (e) {
      console.error('[updateEnvironment] failed:', e)
      showToast(t('toast.failedSaveChanges'))
    }
  }

  async function deleteEnvironmentById(id: string): Promise<void> {
    if (!rootDirHandle.value) return
    try {
      await deleteEnvironment(rootDirHandle.value, id)
      await loadVersionsAndMigrations()
    } catch (e) {
      console.error('[deleteEnvironmentById] failed:', e)
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
