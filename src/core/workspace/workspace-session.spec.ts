import { describe, expect, it, vi } from 'vitest'
import type { Field, InitialData, Schema, Table } from '@/types/schema'
import { affectedSql, affectedTable } from '@/core/history/command'
import { buildInitialDataExport } from '@/utils/initial-data-io'
import { DEFAULT_UNIFIED_TYPES } from '@/utils/unified-types'
import { COMMON_FILE, CURRENT_STRUCT_VERSION, ENVIRONMENTS_DIR, MIGRATIONS_DIR, VERSIONS_DIR } from './layout'
import type { FileChange, SaveMode, SaveState } from './save-coordinator'
import { databasePath, jsonContent, projectSourceFiles, tableDirectory } from './project-documents'
import { buildSchemaWriteData, buildTableExportData } from './serialization'
import { createDefaultCommonConfig, createWorkspaceSession, loadWorkspaceDocuments } from './workspace-session'

class FakeWriter {
  readonly supportsAutoSave = true
  readonly saved: FileChange[][] = []
  failNext: unknown = null
  private readonly expected = new Map<string, string | null>()

  constructor(readonly tree: Map<string, string | null>) {}

  async load(paths: readonly string[]): Promise<Map<string, string>> {
    const files = new Map<string, string>()
    for (const path of paths) {
      const content = this.tree.get(path) ?? null
      this.expected.set(path, content)
      if (content !== null) files.set(path, content)
    }
    return files
  }

  async listFiles(directory: string): Promise<string[]> {
    return [...this.tree.keys()].filter(path => path.startsWith(`${directory}/`) && this.tree.get(path) !== null)
  }

  async hasExternalChanges(paths: readonly string[]): Promise<boolean> {
    return paths.some(path => (this.tree.get(path) ?? null) !== (this.expected.get(path) ?? null))
  }

  async save(changes: readonly FileChange[], _mode: SaveMode) {
    if (this.failNext !== null) return { savedPaths: [], error: this.failNext }
    const batch = changes.map(change => ({ ...change }))
    this.saved.push(batch)
    for (const change of batch) {
      if (change.content === null) this.tree.delete(change.path)
      else this.tree.set(change.path, change.content)
      this.expected.set(change.path, change.content)
    }
    return { savedPaths: batch.map(change => change.path) }
  }

  touch(path: string, content: string | null) {
    this.tree.set(path, content)
  }
}

const field = (name: string): Field => ({ field_name: name, field_type: 'bigint', primary_key: true, not_null: true })
const users = (): Table => ({ name: 'users', comment: '用户表', fields: [field('id')], indexes: [] })
const roles = (): Table => ({ name: 'roles', comment: '', fields: [], indexes: [] })
const events = (): Table => ({ name: 'events', comment: '', fields: [], indexes: [] })
const schemaText = (schema: Schema, tableOrder?: string[]) =>
  jsonContent({ ...buildSchemaWriteData(schema), ...(tableOrder ? { table_order: tableOrder } : {}) })

function fixture(options: { initialData?: boolean } = {}) {
  const common = createDefaultCommonConfig()
  common.project_name = 'demo'
  const tree = new Map<string, string | null>([
    [COMMON_FILE, jsonContent(common)],
    [databasePath, jsonContent({ schema_order: ['app', 'audit'] })],
    ['current/schemas/app/schema.json', schemaText({ schema: 'app', tables: [users(), roles()] }, ['roles', 'users'])],
    ['current/schemas/audit/schema.json', schemaText({ schema: 'audit', tables: [events()] })],
    [`${tableDirectory('app', 'users')}/table.json`, jsonContent(buildTableExportData(users()))],
    [`${tableDirectory('app', 'roles')}/table.json`, jsonContent(buildTableExportData(roles()))],
    [`${tableDirectory('audit', 'events')}/table.json`, jsonContent(buildTableExportData(events()))],
    [`${VERSIONS_DIR}/v1.json`, jsonContent({ id: 'v1' })],
    [`${VERSIONS_DIR}/nested/v2.json`, jsonContent({ id: 'v2' })],
    [`${MIGRATIONS_DIR}/m1.json`, jsonContent({ id: 'm1' })],
    [`${ENVIRONMENTS_DIR}/dev.json`, jsonContent({ id: 'dev' })],
    ['output/mysql/app.sql', '-- 磁盘上的旧 SQL'],
  ])
  if (options.initialData !== false) {
    tree.set(`${tableDirectory('app', 'users')}/initial-data.json`, jsonContent(buildInitialDataExport({ rows: [{ data: { id: 1 } }] } as InitialData)))
  }
  return { writer: new FakeWriter(tree), tree }
}

describe('loadWorkspaceDocuments', () => {
  it('loads every document and restores schema/table order plus config defaults', async () => {
    const { writer } = fixture()
    const { project, files } = await loadWorkspaceDocuments(writer)
    expect(project.common?.struct_version).toBe(CURRENT_STRUCT_VERSION)
    expect(project.common?.project_name).toBe('demo')
    expect(project.common?.unified_types).toHaveLength(DEFAULT_UNIFIED_TYPES.length)
    expect(project.common?.default_config.postgresql).toEqual({ quote_identifiers: true })
    expect(project.common?.schema_order).toEqual(['app', 'audit'])
    expect(project.schemas.map(schema => schema.schema)).toEqual(['app', 'audit'])
    expect(project.schemas[0]!.tables.map(table => table.name)).toEqual(['roles', 'users'])
    expect(project.schemas[0]!.tables[1]!.comment).toBe('用户表')
    expect(project.initialData.get('app/users')!.rows).toEqual([{ data: { id: 1 } }])
    for (const path of projectSourceFiles(project).keys()) expect(files.has(path)).toBe(true)
  })

  it('seeds the baseline from the loaded documents and skips nested auxiliary files', async () => {
    const { writer } = fixture()
    const { files } = await loadWorkspaceDocuments(writer)
    expect(files.get(databasePath)).toBe(writer.tree.get(databasePath))
    expect(files.get(`${tableDirectory('app', 'users')}/table.json`)).toBe(writer.tree.get(`${tableDirectory('app', 'users')}/table.json`))
    expect(files.get('output/mysql/app.sql')).toBe('-- 磁盘上的旧 SQL')
    expect(files.get(`${VERSIONS_DIR}/v1.json`)).toBeTypeOf('string')
    expect(files.has(`${VERSIONS_DIR}/nested/v2.json`)).toBe(false)
  })

  it('treats a missing initial-data file as no data', async () => {
    const { writer } = fixture({ initialData: false })
    const { project, files } = await loadWorkspaceDocuments(writer)
    expect(project.initialData.size).toBe(0)
    expect(files.has(`${tableDirectory('app', 'users')}/initial-data.json`)).toBe(false)
  })

  it('accepts a legacy array of initial-data rows', async () => {
    const { writer } = fixture()
    writer.tree.set(`${tableDirectory('app', 'users')}/initial-data.json`, jsonContent([{ id: 1 }]))
    const { project } = await loadWorkspaceDocuments(writer)
    expect(project.initialData.get('app/users')).toEqual({ rows: [{ data: { id: 1 } }] })
  })

  it.each([
    ['a missing common.json', (tree: Map<string, string | null>) => tree.delete(COMMON_FILE), `Missing project document: ${COMMON_FILE}`],
    ['an empty common.json', (tree: Map<string, string | null>) => tree.set(COMMON_FILE, '{}'), `Invalid project document: ${COMMON_FILE}`],
    ['a schema name that does not match its directory', (tree: Map<string, string | null>) => tree.set('current/schemas/app/schema.json', schemaText({ schema: 'other', tables: [] })), 'Invalid schema document'],
    ['a table name that does not match its directory', (tree: Map<string, string | null>) => tree.set(`${tableDirectory('app', 'roles')}/table.json`, jsonContent({ ...roles(), name: 'nope' })), 'Invalid table document'],
    ['non-array table fields', (tree: Map<string, string | null>) => tree.set(`${tableDirectory('app', 'users')}/table.json`, jsonContent({ ...users(), fields: {} })), 'Invalid table document'],
    ['a non-object initial-data document', (tree: Map<string, string | null>) => tree.set(`${tableDirectory('app', 'users')}/initial-data.json`, '7'), 'Invalid initial data document'],
  ])('rejects a project with %s', async (_label, mutate, message) => {
    const { writer } = fixture()
    mutate(writer.tree)
    await expect(loadWorkspaceDocuments(writer)).rejects.toThrow(message)
  })

  it('ignores stale table_order entries', async () => {
    const { writer } = fixture()
    writer.tree.set('current/schemas/app/schema.json', schemaText({ schema: 'app', tables: [users(), roles()] }, ['ghost', 'users', 'roles']))
    const { project } = await loadWorkspaceDocuments(writer)
    expect(project.schemas[0]!.tables.map(table => table.name)).toEqual(['users', 'roles'])
  })
})

describe('createWorkspaceSession', () => {
  async function open(options: { autoSave?: boolean } = {}) {
    const { writer } = fixture()
    const { project, files } = await loadWorkspaceDocuments(writer)
    const states: SaveState[] = []
    const session = createWorkspaceSession({
      writer,
      files,
      project: () => project,
      autoSave: options.autoSave ?? true,
      onStateChange: state => states.push(state),
    })
    return { writer, project, states, ...session }
  }

  const editedTable = () => `${tableDirectory('app', 'users')}/table.json`

  it('writes the touched table and the derived SQL, nothing else', async () => {
    const { writer, project, states, changed, coordinator } = await open()
    project.schemas[0]!.tables[1]!.comment = '改过'
    changed([affectedTable('app', 'users')])
    await coordinator.saveChanges()
    expect(writer.saved).toHaveLength(1)
    const first = writer.saved[0]!.map(change => change.path)
    expect(first).toContain(editedTable())
    expect(first).toContain('output/mysql/audit.sql')
    expect(first).toContain('output/mysql/__initial_data__.sql')
    expect(first).toHaveLength(16)
    expect(first).not.toContain('common.json')
    expect(first).not.toContain('current/schemas/app/schema.json')
    expect(first).not.toContain(`${tableDirectory('app', 'roles')}/table.json`)

    project.schemas[0]!.tables[1]!.comment = '又改一次'
    changed([affectedTable('app', 'users')])
    await coordinator.saveChanges()
    expect(writer.saved).toHaveLength(2)
    expect(writer.saved[1]!.map(change => change.path)).toEqual([
      editedTable(),
      'output/mysql/app.sql', 'output/mysql/__all_schemas__.sql', 'output/mysql/__all__.sql',
      'output/postgresql/app.sql', 'output/postgresql/__all_schemas__.sql', 'output/postgresql/__all__.sql',
      'output/sqlite/app.sql', 'output/sqlite/__all_schemas__.sql', 'output/sqlite/__all__.sql',
    ])
    expect(coordinator.state.dirty).toBe(false)
    expect(states.at(-1)).toMatchObject({ dirty: false, saving: false, error: null, pendingFiles: 0 })
  })

  it('stays clean when the affected files describe unchanged content', async () => {
    const { writer, changed, coordinator } = await open()
    changed([affectedTable('app', 'users')])
    expect(coordinator.state.dirty).toBe(false)
    await coordinator.saveChanges()
    expect(writer.saved).toHaveLength(0)
  })

  it('coalesces a burst of edits into one auto save that only carries the touched documents', async () => {
    vi.useFakeTimers()
    try {
      const { writer, project, changed, coordinator } = await open()
      for (let round = 1; round <= 5; round++) {
        project.schemas[0]!.tables[1]!.comment = `第 ${round} 次编辑`
        changed([affectedTable('app', 'users')])
      }
      await vi.advanceTimersByTimeAsync(400)
      expect(writer.saved).toHaveLength(1)
      const paths = writer.saved[0]!.map(change => change.path)
      expect(paths.filter(path => path === editedTable())).toHaveLength(1)
      expect(writer.tree.get(editedTable())).toContain('第 5 次编辑')
      expect(coordinator.state).toMatchObject({ dirty: false, saving: false, pendingFiles: 0 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds edits in memory while auto save is off and flushes them on manual save', async () => {
    const { writer, project, changed, saveAll, coordinator } = await open({ autoSave: false })
    project.schemas[0]!.tables[1]!.comment = '待保存'
    changed([affectedTable('app', 'users')])
    await Promise.resolve()
    expect(coordinator.state).toMatchObject({ dirty: true, pendingFiles: 1 })
    expect(writer.saved).toHaveLength(0)
    await saveAll()
    expect(writer.tree.get(editedTable())).toContain('待保存')
    expect(coordinator.state.dirty).toBe(false)
  })

  it('checks external content only after the write queue drains', async () => {
    const { writer, project, changed, coordinator, hasExternalChanges } = await open()
    project.schemas[0]!.tables[1]!.comment = '本地改动'
    changed([affectedTable('app', 'users')])
    const flush = coordinator.saveChanges()
    const check = hasExternalChanges([editedTable(), `${VERSIONS_DIR}/v1.json`])
    writer.touch(`${VERSIONS_DIR}/v1.json`, '外部改写')
    await flush
    expect(writer.saved).toHaveLength(1)
    expect(writer.tree.get(editedTable())).toContain('本地改动')
    expect(await check).toBe(true)
    expect(coordinator.state.dirty).toBe(false)
    expect(await hasExternalChanges([editedTable()])).toBe(false)
  })

  it('regenerates every source and output file on manual save', async () => {
    const { writer, project, changed, saveAll } = await open({ autoSave: false })
    project.schemas.push({ schema: 'extra', tables: [] })
    changed([affectedSql()])
    await saveAll()
    const paths = writer.saved.flat().map(change => change.path)
    expect(paths).toContain(editedTable())
    expect(paths).toContain('current/schemas/extra/schema.json')
    expect(writer.tree.get('output/mysql/app.sql')).not.toBe('-- 磁盘上的旧 SQL')
  })

  it('deletes project files that disappeared from memory on manual save', async () => {
    const { writer, project, saveAll } = await open({ autoSave: false })
    project.schemas[1]!.tables.pop()
    await saveAll()
    const removed = writer.saved.flat().filter(change => change.content === null).map(change => change.path)
    expect(removed).toEqual([`${tableDirectory('audit', 'events')}/table.json`])
    expect(writer.tree.has(`${tableDirectory('audit', 'events')}/table.json`)).toBe(false)
  })

  it('surfaces a writer failure and keeps the file dirty for retry', async () => {
    const { writer, project, changed, coordinator, states } = await open()
    const failure = new Error('quota exceeded')
    writer.failNext = failure
    project.schemas[0]!.tables[1]!.comment = '写盘失败'
    changed([affectedTable('app', 'users')])
    await expect(coordinator.saveChanges()).rejects.toThrow(failure)
    expect(coordinator.state).toMatchObject({ dirty: true, saving: false, error: failure })
    expect(states.at(-1)).toMatchObject({ error: failure })
    expect(writer.saved).toHaveLength(0)
    writer.failNext = null
    await coordinator.saveChanges()
    expect(writer.saved).toHaveLength(1)
    expect(coordinator.state).toMatchObject({ dirty: false, error: null })
  })

  it('ignores changes and rejects saves once disposed', async () => {
    const { project, changed, coordinator } = await open({ autoSave: false })
    await coordinator.dispose()
    project.schemas[0]!.tables[1]!.comment = '关闭之后'
    changed([affectedTable('app', 'users')])
    expect(coordinator.state.dirty).toBe(false)
    await expect(coordinator.saveAll()).rejects.toThrow('Workspace is closed')
  })
})
