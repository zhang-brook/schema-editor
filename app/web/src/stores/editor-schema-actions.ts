import type { Schema, Table } from 'schema-editor-core/types/schema'
import { affectedDatabase, affectedInitialData, affectedSchema, affectedSql, affectedTable, type AffectedFile } from 'schema-editor-core/core/history/command'
import { confirmDialog } from '@/composables/useConfirm'
import { captureValue, cloneValue, diskName, moveItem, removeItem, uniqueName, validName } from './editor-action-utils'
import type { CrudDeps } from './editor-crud'

export function createSchemaActions(deps: CrudDeps) {
  const { schemas, commonConfig, selectedSchemaIdx, selectedTableIdx, initialDataMap, initialDataDeletedKeys, initialDataKey, executeCommand, showToast, t } = deps

  function syncSchemaOrder() {
    if (commonConfig.value) commonConfig.value.schema_order = schemas.map(s => s.schema)
  }

  /** Load-time ordering only; interactive reordering uses moveSchema. */
  function applySchemaOrder() {
    const order = commonConfig.value?.schema_order
    if (!order?.length) return
    schemas.sort((a, b) => {
      const ai = order.indexOf(a.schema)
      const bi = order.indexOf(b.schema)
      return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi)
    })
  }

  function selectTable(schemaIdx: number, tableIdx: number) {
    selectedSchemaIdx.value = schemaIdx
    selectedTableIdx.value = tableIdx
    deps.expandedFields.clear()
    deps.expandedIndexes.clear()
  }
  function selectSchemaOnly(schemaIdx: number) { selectTable(schemaIdx, -1) }

  function checkName(name: string, names: string[], kind: 'schema' | 'table', oldName?: string) {
    if (!validName(name)) return false
    // A case-only / sanitized alias rename cannot safely move a directory on all supported filesystems.
    if (names.some(n => diskName(n) === diskName(name)) || (oldName !== undefined && oldName !== name && diskName(oldName) === diskName(name))) {
      showToast(t(kind === 'schema' ? 'toast.schemaExists' : 'toast.tableExists', { name }))
      return false
    }
    return true
  }

  function tablePaths(schema: string, table: string): AffectedFile[] {
    return [affectedTable(schema, table), affectedInitialData(schema, table)]
  }
  function schemaPaths(name: string, tables: string[]): AffectedFile[] {
    return [affectedSchema(name), ...tables.flatMap(table => tablePaths(name, table))]
  }
  function dataEntries(schema: Schema) {
    return schema.tables.map(table => {
      const key = initialDataKey(schema.schema, table.name)
      return { key, restore: captureValue(initialDataMap.get(key)) }
    })
  }
  function removeData(entries: ReturnType<typeof dataEntries>) {
    for (const { key } of entries) {
      initialDataMap.delete(key)
      initialDataDeletedKeys.add(key)
    }
  }
  function restoreData(entries: ReturnType<typeof dataEntries>) {
    for (const { key, restore } of entries) {
      const data = restore()
      if (data !== undefined) initialDataMap.set(key, data)
      initialDataDeletedKeys.delete(key)
    }
  }
  function migrateData(from: string, to: string) {
    const data = initialDataMap.get(from)
    initialDataMap.delete(from)
    if (data !== undefined) initialDataMap.set(to, data)
    initialDataDeletedKeys.add(from)
    initialDataDeletedKeys.delete(to)
  }

  function moveSchema(fromIdx: number, toIdx: number) {
    const schema = schemas[fromIdx]
    if (!schema || toIdx < 0 || toIdx >= schemas.length || fromIdx === toIdx) return
    executeCommand({
      label: t('history.moveSchema'),
      apply() { moveItem(schemas, schema, toIdx); syncSchemaOrder() },
      revert() { moveItem(schemas, schema, fromIdx); syncSchemaOrder() },
      affectedFiles: () => [affectedDatabase(), affectedSql()],
    })
  }

  function addSchema(name: string) {
    name = name.trim()
    if (!checkName(name, schemas.map(s => s.schema), 'schema')) return
    const schema: Schema = { schema: name, tables: [] }
    const restore = captureValue(schema)
    executeCommand({
      label: t('history.addSchema'),
      apply() { schemas.push(restore()); syncSchemaOrder() },
      revert() { removeItem(schemas, schema); syncSchemaOrder() },
      affectedFiles: () => [affectedDatabase(), affectedSchema(name), affectedSql()],
    })
    selectSchemaOnly(schemas.length - 1)
    showToast(t('toast.schemaCreated'))
  }

  async function deleteSchema(schemaIdx: number) {
    const schema = schemas[schemaIdx]
    if (!schema || !(await confirmDialog({ title: t('confirm.title'), message: t('confirm.deleteSchema', { name: schema.schema }), confirmText: t('confirm.ok'), cancelText: t('confirm.cancel') }))) return
    const idx = schemas.indexOf(schema)
    if (idx < 0) return
    const restore = captureValue(schema)
    const entries = dataEntries(schema)
    const paths = schemaPaths(schema.schema, schema.tables.map(table => table.name))
    executeCommand({
      label: t('history.deleteSchema', { name: schema.schema }),
      apply() {
        removeData(entries)
        removeItem(schemas, schema)
        syncSchemaOrder()
        if (!schemas.length) selectSchemaOnly(-1)
        else if (selectedSchemaIdx.value >= schemas.length) selectSchemaOnly(schemas.length - 1)
      },
      revert() {
        schemas.splice(idx, 0, restore())
        restoreData(entries)
        syncSchemaOrder()
        selectTable(idx, schema.tables.length ? 0 : -1)
      },
      affectedFiles: () => [affectedDatabase(), ...paths, affectedSql()],
    })
    showToast(t('toast.schemaDeleted'))
  }

  function renameSchema(schemaIdx: number, newName: string) {
    const schema = schemas[schemaIdx]
    if (!schema) return
    newName = newName.trim()
    const oldName = schema.schema
    if (newName === oldName || !checkName(newName, schemas.filter(s => s !== schema).map(s => s.schema), 'schema', oldName)) return
    const tables = schema.tables.map(table => table.name)
    const migrations = tables.map(table => [initialDataKey(oldName, table), initialDataKey(newName, table)] as const)
    executeCommand({
      label: t('history.renameSchema', { name: newName }),
      apply() {
        schema.schema = newName
        syncSchemaOrder()
        migrations.forEach(([oldKey, newKey]) => migrateData(oldKey, newKey))
      },
      revert() {
        schema.schema = oldName
        syncSchemaOrder()
        migrations.forEach(([oldKey, newKey]) => migrateData(newKey, oldKey))
      },
      affectedFiles: () => [affectedDatabase(), ...schemaPaths(oldName, tables), ...schemaPaths(newName, tables), affectedSql()],
    })
    showToast(t('toast.schemaRenamed'))
  }

  function addTable(schemaIdx: number) {
    const schema = schemas[schemaIdx]
    if (!schema) return
    const name = uniqueName('new_table', schema.tables.map(table => table.name))
    const table: Table = { name, comment: '', fields: [], indexes: [] }
    const restore = captureValue(table)
    executeCommand({
      label: t('history.addTable'),
      apply() { schema.tables.push(restore()) },
      revert() { removeItem(schema.tables, table) },
      affectedFiles: () => [affectedSchema(schema.schema), affectedTable(schema.schema, name), affectedSql()],
    })
    selectTable(schemaIdx, schema.tables.length - 1)
    showToast(t('toast.tableAdded'))
  }

  function renameTable(schemaIdx: number, tableIdx: number, newName: string): boolean {
    const schema = schemas[schemaIdx]
    const table = schema?.tables[tableIdx]
    if (!schema || !table) return false
    newName = newName.trim()
    const oldName = table.name
    if (newName === oldName) return true
    if (!checkName(newName, schema.tables.filter(t => t !== table).map(t => t.name), 'table', oldName)) return false
    const schemaName = schema.schema
    const oldKey = initialDataKey(schemaName, oldName)
    const newKey = initialDataKey(schemaName, newName)
    executeCommand({
      label: t('history.renameTable', { name: newName }),
      apply() { table.name = newName; migrateData(oldKey, newKey) },
      revert() { table.name = oldName; migrateData(newKey, oldKey) },
      affectedFiles: () => [affectedSchema(schemaName), ...tablePaths(schemaName, oldName), ...tablePaths(schemaName, newName), affectedSql()],
    })
    showToast(t('toast.tableRenamed'))
    return true
  }

  async function deleteTable(schemaIdx: number, tableIdx: number) {
    const schema = schemas[schemaIdx]
    const table = schema?.tables[tableIdx]
    if (!schema || !table || !(await confirmDialog({ title: t('confirm.title'), message: t('confirm.deleteTable', { name: table.name }), confirmText: t('confirm.ok'), cancelText: t('confirm.cancel') }))) return
    const idx = schema.tables.indexOf(table)
    if (idx < 0) return
    const restore = captureValue(table)
    const entries = dataEntries({ schema: schema.schema, tables: [table] })
    const paths = tablePaths(schema.schema, table.name)
    executeCommand({
      label: t('history.deleteTable', { name: table.name }),
      apply() {
        removeItem(schema.tables, table)
        removeData(entries)
        if (selectedSchemaIdx.value === schemaIdx && selectedTableIdx.value >= schema.tables.length) selectedTableIdx.value = schema.tables.length - 1
      },
      revert() { schema.tables.splice(idx, 0, restore()); restoreData(entries) },
      affectedFiles: () => [affectedSchema(schema.schema), ...paths, affectedSql()],
    })
    showToast(t('toast.tableDeleted'))
  }

  function copyTable(schemaIdx: number, tableIdx: number) {
    const schema = schemas[schemaIdx]
    const source = schema?.tables[tableIdx]
    if (!schema || !source) return
    const name = uniqueName(`${source.name}_copy`, schema.tables.map(table => table.name))
    const table = cloneValue(source)
    table.name = name
    const restore = captureValue(table)
    const key = initialDataKey(schema.schema, name)
    const data = cloneValue(initialDataMap.get(initialDataKey(schema.schema, source.name)))
    const restoreInitial = captureValue(data)
    executeCommand({
      label: t('history.copyTable', { name }),
      apply() {
        schema.tables.splice(tableIdx + 1, 0, restore())
        if (data !== undefined) initialDataMap.set(key, restoreInitial()!)
        initialDataDeletedKeys.delete(key)
      },
      revert() { removeItem(schema.tables, table); initialDataMap.delete(key); initialDataDeletedKeys.add(key) },
      affectedFiles: () => [affectedSchema(schema.schema), ...tablePaths(schema.schema, name), affectedSql()],
    })
    selectTable(schemaIdx, tableIdx + 1)
    showToast(t('toast.tableCopied', { name }))
  }

  function copySchema(schemaIdx: number) {
    const source = schemas[schemaIdx]
    if (!source) return
    const schema = cloneValue(source)
    schema.schema = uniqueName(`${source.schema}_copy`, schemas.map(s => s.schema))
    const restore = captureValue(schema)
    const entries = source.tables.map(table => ({
      key: initialDataKey(schema.schema, table.name),
      restore: captureValue(cloneValue(initialDataMap.get(initialDataKey(source.schema, table.name)))),
    }))
    const paths = schemaPaths(schema.schema, schema.tables.map(table => table.name))
    executeCommand({
      label: t('history.copySchema', { name: schema.schema }),
      apply() { schemas.splice(schemaIdx + 1, 0, restore()); restoreData(entries); syncSchemaOrder() },
      revert() { removeItem(schemas, schema); removeData(entries); syncSchemaOrder() },
      affectedFiles: () => [affectedDatabase(), ...paths, affectedSql()],
    })
    selectTable(schemaIdx + 1, schema.tables.length ? 0 : -1)
    showToast(t('toast.schemaCopied', { name: schema.schema }))
  }

  /** toIdx is an insertion slot before removal (0..length). */
  function moveTable(schemaIdx: number, fromIdx: number, toIdx: number) {
    const schema = schemas[schemaIdx]
    const table = schema?.tables[fromIdx]
    if (!schema || !table || toIdx < 0 || toIdx > schema.tables.length) return
    const insertIdx = toIdx > fromIdx ? toIdx - 1 : toIdx
    if (insertIdx === fromIdx) return
    const selected = schemas[selectedSchemaIdx.value]?.tables[selectedTableIdx.value]
    const move = (to: number) => {
      moveItem(schema.tables, table, to)
      if (selectedSchemaIdx.value === schemaIdx && selected) selectedTableIdx.value = schema.tables.indexOf(selected)
    }
    executeCommand({ label: t('history.moveTable'), apply: () => move(insertIdx), revert: () => move(fromIdx), affectedFiles: () => [affectedSchema(schema.schema), affectedSql()] })
  }

  function moveTableToSchema(fromSchemaIdx: number, fromTableIdx: number, toSchemaIdx: number, toTableIdx: number) {
    if (fromSchemaIdx === toSchemaIdx) return moveTable(fromSchemaIdx, fromTableIdx, toTableIdx)
    const from = schemas[fromSchemaIdx]
    const to = schemas[toSchemaIdx]
    const table = from?.tables[fromTableIdx]
    if (!from || !to || !table || toTableIdx < 0 || toTableIdx > to.tables.length) return
    if (!checkName(table.name, to.tables.map(t => t.name), 'table')) return
    const oldName = from.schema
    const newName = to.schema
    const tableName = table.name
    const oldKey = initialDataKey(oldName, tableName)
    const newKey = initialDataKey(newName, tableName)
    executeCommand({
      label: t('history.moveTableToSchema'),
      apply() { removeItem(from.tables, table); to.tables.splice(toTableIdx, 0, table); migrateData(oldKey, newKey); selectTable(toSchemaIdx, toTableIdx) },
      revert() { removeItem(to.tables, table); from.tables.splice(fromTableIdx, 0, table); migrateData(newKey, oldKey); selectTable(fromSchemaIdx, fromTableIdx) },
      affectedFiles: () => [affectedSchema(oldName), affectedSchema(newName), ...tablePaths(oldName, tableName), ...tablePaths(newName, tableName), affectedSql()],
    })
  }

  return { syncSchemaOrder, applySchemaOrder, selectTable, selectSchemaOnly, moveSchema, addSchema, deleteSchema, renameSchema, copySchema, addTable, renameTable, deleteTable, copyTable, moveTable, moveTableToSchema }
}
