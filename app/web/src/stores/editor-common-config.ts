import type { Ref } from 'vue'
import type { CommonConfig, Schema, Field, FieldOverride, InitialData, UnifiedTypeDefinition, UnifiedTypeDbMapping, TypeCaseMode, TableDdlMode, LogicalDeleteConfig } from '@/types/schema'
import { affectedCommon, affectedTable, affectedInitialData, affectedSql, type AffectedFile, type Command } from '@/core/history/command'
import type { SqlDialect } from '@/utils/sql-generator/shared'
import { parseFieldLengthInput, parseFieldScaleInput } from '@/utils/file-helpers'
import { confirmDialog } from '@/composables/useConfirm'

export interface CommonConfigDeps {
  commonConfig: Ref<CommonConfig | null>
  schemas: Schema[]
  initialDataMap: Map<string, InitialData>
  executeCommand: (cmd: Command) => void
  showToast: (msg: string) => void
  t: (key: string, options?: Record<string, unknown>) => string
}

// Only clone the edited values, never the project or all definitions. This also
// preserves undefined/null and accepts Vue proxies (unlike structuredClone).
function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => clone(item)) as T
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T
  }
  return value
}

interface Change {
  apply(): void
  revert(): void
  changed: boolean
}

const owns = (object: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(object, key)

/** Resolve the owner again on replay: other commands may replace fields/rows. */
function propertyChange<T extends object, K extends keyof T>(get: () => T, key: K, value: T[K] | undefined): Change {
  const had = owns(get(), key)
  const before = clone(get()[key])
  const after = clone(value)
  const write = (present: boolean, snapshot: T[K] | undefined) => {
    if (present) get()[key] = clone(snapshot) as T[K]
    else delete get()[key]
  }
  return {
    changed: had !== (value !== undefined) || JSON.stringify(before) !== JSON.stringify(after),
    apply: () => write(after !== undefined, after),
    revert: () => write(had, before),
  }
}

function spliceChange<T>(get: () => T[], index: number, count: number, inserted: T[] = []): Change {
  const before = clone(get().slice(index, index + count))
  const after = clone(inserted)
  return {
    changed: true,
    apply: () => { get().splice(index, count, ...clone(after)) },
    revert: () => { get().splice(index, after.length, ...clone(before)) },
  }
}

export function createCommonConfigActions(deps: CommonConfigDeps) {
  const { commonConfig, schemas, initialDataMap, executeCommand, showToast, t } = deps
  const config = () => commonConfig.value!
  const commonSqlFiles = () => [affectedCommon(), affectedSql()]

  function commit(label: string, changes: Change[], files = commonSqlFiles(), coalesceKey?: string, options?: { dialect?: SqlDialect; db?: SqlDialect }): boolean {
    if (!changes.some(change => change.changed)) return false
    // Retain every final assignment, even unchanged keys of a multi-key patch:
    // the last apply must stand alone after coalescing with an earlier patch.
    const effective = changes
    executeCommand({
      label: t(label, options),
      coalesceKey,
      apply: () => { for (const change of effective) change.apply() },
      revert: () => { for (const change of [...effective].reverse()) change.revert() },
      affectedFiles: () => files,
    })
    return true
  }

  function setGlobalSql(dialect: SqlDialect, key: 'pre_sql' | 'post_sql', val: string) {
    if (!commonConfig.value) return
    const value = val.trim() || undefined
    const change = dialect === 'mysql'
      ? propertyChange(() => config().default_config.mysql, key, value)
      : propertyChange(() => config().default_config, dialect, {
          ...(config().default_config[dialect] ?? { quote_identifiers: true }), [key]: value,
        })
    commit(key === 'pre_sql' ? 'history.editGlobalPreSql' : 'history.editGlobalPostSql', [change], commonSqlFiles(), `global-${key}:${dialect}`, { dialect })
  }
  function setGlobalPreSql(dialect: SqlDialect, val: string) { setGlobalSql(dialect, 'pre_sql', val) }
  function setGlobalPostSql(dialect: SqlDialect, val: string) { setGlobalSql(dialect, 'post_sql', val) }

  function setProjectName(val: string) {
    if (!commonConfig.value) return
    commit('history.editProjectName', [propertyChange(config, 'project_name', val.trim() ? val : undefined)], [affectedCommon()], 'project-name')
  }
  function setProjectDescription(val: string) {
    if (!commonConfig.value) return
    commit('history.editProjectDescription', [propertyChange(config, 'project_description', val.trim() ? val : undefined)], [affectedCommon()], 'project-description')
  }

  function getCommonMysqlEngine() { return commonConfig.value?.default_config?.mysql?.table?.mysql_engine || '' }
  function getCommonMysqlCharset() { return commonConfig.value?.default_config?.mysql?.table?.mysql_charset || '' }
  function getCommonMysqlCollation() { return commonConfig.value?.default_config?.mysql?.table?.mysql_collation || '' }
  function setMysqlTableOption(key: 'mysql_engine' | 'mysql_charset' | 'mysql_collation', val: string, label: string) {
    if (!commonConfig.value) return
    commit(label, [propertyChange(() => config().default_config.mysql.table, key, val)], commonSqlFiles(), `common-${key}`)
  }
  function setCommonMysqlEngine(val: string) { setMysqlTableOption('mysql_engine', val, 'history.editMysqlEngine') }
  function setCommonMysqlCharset(val: string) { setMysqlTableOption('mysql_charset', val, 'history.editMysqlCharset') }
  function setCommonMysqlCollation(val: string) { setMysqlTableOption('mysql_collation', val, 'history.editMysqlCollation') }

  function getCommonPostgresqlQuoteIdentifiers() { return commonConfig.value?.default_config?.postgresql?.quote_identifiers ?? true }
  function getCommonSqliteQuoteIdentifiers() { return commonConfig.value?.default_config?.sqlite?.quote_identifiers ?? true }
  function setQuoteIdentifiers(dialect: 'postgresql' | 'sqlite', val: boolean) {
    if (!commonConfig.value) return
    commit(dialect === 'sqlite' ? 'history.editSqliteQuoteIdentifiers' : 'history.editPgQuoteIdentifiers', [
      propertyChange(() => config().default_config, dialect, { ...config().default_config[dialect], quote_identifiers: val }),
    ])
  }
  function setCommonPostgresqlQuoteIdentifiers(val: boolean) { setQuoteIdentifiers('postgresql', val) }
  function setCommonSqliteQuoteIdentifiers(val: boolean) { setQuoteIdentifiers('sqlite', val) }
  function getTableDdlMode(): TableDdlMode { return commonConfig.value?.default_config?.table_ddl_mode ?? 'drop_and_create' }
  function setTableDdlMode(val: TableDdlMode) {
    if (!commonConfig.value) return
    commit('history.editTableDdlMode', [propertyChange(() => config().default_config, 'table_ddl_mode', val === 'drop_and_create' ? undefined : val)])
  }
  function getCommonTypeCase(): TypeCaseMode { return commonConfig.value?.type_case ?? 'keep' }
  function setCommonTypeCase(val: TypeCaseMode) {
    if (!commonConfig.value) return
    commit('history.editTypeCase', [propertyChange(config, 'type_case', val)])
  }
  function getLogicalDelete(): LogicalDeleteConfig { return commonConfig.value?.logical_delete ?? {} }
  function setLogicalDelete(patch: Partial<LogicalDeleteConfig>) {
    if (!commonConfig.value) return
    const next = { ...config().logical_delete, ...clone(patch) }
    for (const key of Object.keys(next) as (keyof LogicalDeleteConfig)[]) {
      if (next[key] === undefined || next[key] === '') delete next[key]
    }
    commit('history.editLogicalDelete', [propertyChange(config, 'logical_delete', Object.keys(next).length ? next : undefined)], commonSqlFiles(), JSON.stringify(['logical-delete', Object.keys(patch).sort()]))
  }

  // ===== Common fields =====
  function getOrderedCommonUsedFields(): Field[] {
    if (!commonConfig.value) return []
    const record = config().common_used_fields
    // Keep legacy/incomplete order lists usable without losing unlisted fields.
    const keys = [...new Set([...(config().common_used_field_order ?? []), ...Object.keys(record)])]
    return keys.filter(key => owns(record, key)).map(key => record[key]!)
  }

  function addCommonUsedField(name: string): boolean {
    if (!commonConfig.value) return false
    const key = name.trim()
    if (!key) { showToast(t('toast.pleaseEnterFieldName')); return false }
    if (owns(config().common_used_fields, key)) { showToast(t('toast.commonFieldExists', { name: key })); return false }
    const added = commit('history.addCommonField', [
      propertyChange(() => config().common_used_fields, key, {
        field_name: key, field_type: 'varchar', field_length: 255, not_null: false, primary_key: false, comment: '',
      }),
      propertyChange(config, 'common_used_field_order', [...getOrderedCommonUsedFields().map(field => field.field_name), key]),
    ], [affectedCommon()])
    if (added) showToast(t('toast.commonFieldAdded'))
    return added
  }

  /** Preserve record insertion order without snapshotting unrelated definitions. */
  function commonDefinitionChange(oldName: string, newName?: string): Change {
    const beforeKeys = Object.keys(config().common_used_fields)
    const before = clone(config().common_used_fields[oldName]!)
    const after = newName === undefined ? undefined : { ...clone(before), field_name: newName }
    const afterKeys = beforeKeys.flatMap(key => key === oldName ? (newName === undefined ? [] : [newName]) : [key])
    const write = (keys: string[], name: string | undefined, field: Field | undefined) => {
      const current = config().common_used_fields
      config().common_used_fields = Object.fromEntries(keys.map(key => [key, key === name ? clone(field!) : current[key]!]))
    }
    return {
      changed: true,
      apply: () => write(afterKeys, newName, after),
      revert: () => write(beforeKeys, oldName, before),
    }
  }

  function commonFieldTables(name: string) {
    return schemas.flatMap(schema => schema.tables
      .filter(table => table.fields.some(field => field.use_common_used_fields && field.field_name === name))
      .map(table => {
        const schemaName = schema.schema
        const tableName = table.name
        return {
          schemaName, tableName,
          get: () => schemas.find(item => item.schema === schemaName)!.tables.find(item => item.name === tableName)!,
        }
      }))
  }

  /** Move/remove only the referenced keys, including false/null values. */
  function keyedChanges<T>(get: () => Record<string, T>, oldName: string, newName?: string): Change[] {
    if (!owns(get(), oldName)) return []
    const changes: Change[] = []
    if (newName !== undefined) changes.push(propertyChange(get, newName, get()[oldName]))
    changes.push(propertyChange(get, oldName, undefined))
    return changes
  }

  function initialDataChanges(schema: string, table: string, oldName: string, newName?: string): Change[] {
    const key = `${schema}/${table}`
    return (initialDataMap.get(key)?.rows ?? []).flatMap((row, index) => {
      return (['data', 'field_comments', 'expr_fields'] as const).flatMap(property => {
        if (!row[property] || !owns(row[property], oldName)) return []
        return keyedChanges(() => initialDataMap.get(key)!.rows![index]![property]! as Record<string, unknown>, oldName, newName)
      })
    })
  }

  async function deleteCommonUsedField(name: string): Promise<boolean> {
    if (!commonConfig.value || !owns(config().common_used_fields, name)) return false
    const originalConfig = config()
    const references = commonFieldTables(name)
    if (references.length && !(await confirmDialog({
      title: t('confirm.title'), message: t('confirm.deleteCommonField', { name, refs: references.map(ref => `${ref.schemaName}.${ref.tableName}`).join('\n') }),
      confirmText: t('confirm.ok'), cancelText: t('confirm.cancel'),
    }))) return false
    // Confirmation is asynchronous: do not capture old snapshots before it, or
    // apply them to a project opened while the dialog was pending.
    if (commonConfig.value !== originalConfig || !owns(config().common_used_fields, name)) return false
    const changes: Change[] = [commonDefinitionChange(name)]
    const files: AffectedFile[] = commonSqlFiles()
    if (config().common_used_field_order !== undefined) {
      const order = config().common_used_field_order!.filter(key => key !== name)
      changes.push(propertyChange(config, 'common_used_field_order', order.length ? order : undefined))
    }
    for (const ref of commonFieldTables(name)) {
      const table = ref.get()
      // Descending removal, ascending restoration; snapshots are only the
      // removed fields and indexes that actually reference them.
      for (let index = table.fields.length - 1; index >= 0; index--) {
        const field = table.fields[index]!
        if (field.use_common_used_fields && field.field_name === name) changes.push(spliceChange(() => ref.get().fields, index, 1))
      }
      for (let index = table.indexes.length - 1; index >= 0; index--) {
        const item = table.indexes[index]!
        if (!item.columns.some(column => column.name === name)) continue
        const columns = item.columns.filter(column => column.name !== name)
        changes.push(spliceChange(() => ref.get().indexes, index, 1, columns.length ? [{ ...item, columns }] : []))
      }
      if (table.comment_before_fields && owns(table.comment_before_fields, name)) {
        const next = clone(table.comment_before_fields)
        delete next[name]
        changes.push(propertyChange(ref.get, 'comment_before_fields', Object.keys(next).length ? next : undefined))
      }
      const dataChanges = initialDataChanges(ref.schemaName, ref.tableName, name)
      changes.push(...dataChanges)
      files.push(affectedTable(ref.schemaName, ref.tableName))
      if (dataChanges.length) files.push(affectedInitialData(ref.schemaName, ref.tableName))
    }
    commit('history.deleteCommonField', changes, files)
    showToast(t('toast.commonFieldDeleted'))
    return true
  }

  function updateCommonUsedFieldName(oldName: string, newName: string): boolean {
    if (!commonConfig.value || !owns(config().common_used_fields, oldName)) return false
    const name = newName.trim()
    if (!name) { showToast(t('toast.fieldNameEmpty')); return false }
    if (oldName === name) return false
    const references = commonFieldTables(oldName)
    if (owns(config().common_used_fields, name) || references.some(ref => ref.get().fields.some(field => field.field_name === name))) {
      showToast(t('toast.commonFieldExists', { name })); return false
    }
    const changes = [commonDefinitionChange(oldName, name)]
    const files: AffectedFile[] = commonSqlFiles()
    if (config().common_used_field_order !== undefined) changes.push(propertyChange(config, 'common_used_field_order', config().common_used_field_order!.map(key => key === oldName ? name : key)))
    for (const ref of references) {
      const table = ref.get()
      table.fields.forEach((field, index) => {
        if (field.use_common_used_fields && field.field_name === oldName) changes.push(propertyChange(() => ref.get().fields[index]!, 'field_name', name))
      })
      table.indexes.forEach((index, indexPosition) => index.columns.forEach((column, columnPosition) => {
        if (column.name === oldName) changes.push(propertyChange(() => ref.get().indexes[indexPosition]!.columns[columnPosition]!, 'name', name))
      }))
      if (table.comment_before_fields) changes.push(...keyedChanges(() => ref.get().comment_before_fields!, oldName, name))
      const dataChanges = initialDataChanges(ref.schemaName, ref.tableName, oldName, name)
      changes.push(...dataChanges)
      files.push(affectedTable(ref.schemaName, ref.tableName))
      if (dataChanges.length) files.push(affectedInitialData(ref.schemaName, ref.tableName))
    }
    const renamed = commit('history.renameCommonField', changes, files)
    if (renamed) showToast(t('toast.commonFieldRenamed'))
    return renamed
  }

  function updateCommonUsedField(name: string, patch: Partial<Omit<Field, 'field_name'>>, coalesce = false): boolean {
    if (!commonConfig.value || !owns(config().common_used_fields, name) || owns(patch, 'field_name')) return false
    const next = clone(patch)
    if (next.unified_type) { next.field_type = undefined; next.quote_default = undefined }
    const keys = Object.keys(next) as (keyof typeof next)[]
    return commit('history.editCommonFields', keys.map(key => propertyChange(() => config().common_used_fields[name]!, key, next[key])), commonSqlFiles(), coalesce ? JSON.stringify(['common-field', name, keys.sort()]) : undefined)
  }

  function setCommonUsedFieldOverrideValue(name: string, db: SqlDialect, key: keyof FieldOverride, raw: string): boolean {
    if (!commonConfig.value || !owns(config().common_used_fields, name)) return false
    const next = clone(config().common_used_fields[name]![db] ?? {})
    const value = raw === '' ? undefined : key === 'field_length' || key === 'field_scale' ? parseFieldLengthInput(raw) : raw
    if (value === undefined) delete next[key]
    else Object.assign(next, { [key]: value })
    return commit('history.editFieldOverride', [propertyChange(() => config().common_used_fields[name]!, db, Object.keys(next).length ? next : undefined)], commonSqlFiles(), JSON.stringify(['common-field-override', name, db, key]), { db })
  }

  function validMove(length: number, from: number, to: number) {
    return Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= 0 && from < length && to < length && from !== to
  }
  function moveCommonUsedField(from: number, to: number): boolean {
    if (!commonConfig.value) return false
    const order = getOrderedCommonUsedFields().map(field => field.field_name)
    if (!validMove(order.length, from, to)) return false
    order.splice(to, 0, order.splice(from, 1)[0]!)
    return commit('history.editCommonFields', [propertyChange(config, 'common_used_field_order', order)], [affectedCommon()])
  }

  // ===== Unified types =====
  function addUnifiedType(name: string): boolean {
    if (!commonConfig.value) return false
    const key = name.trim()
    if (!key) { showToast(t('toast.unifiedTypeNameEmpty')); return false }
    if (config().unified_types?.some(type => type.name === key)) { showToast(t('toast.unifiedTypeExists', { name: key })); return false }
    const changes: Change[] = []
    if (!config().unified_types) changes.push(propertyChange(config, 'unified_types', []))
    // Capture an empty slice without creating the optional list outside apply.
    changes.push(spliceChange(() => config().unified_types ?? [], config().unified_types?.length ?? 0, 0, [{
      name: key, description: '', quote_default: false,
      mysql: { type: 'VARCHAR', length: 255 }, postgresql: { type: 'VARCHAR', length: 255 }, sqlite: { type: 'VARCHAR', length: 255 },
    }]))
    commit('history.addUnifiedType', changes)
    showToast(t('toast.unifiedTypeAdded'))
    return true
  }

  function deleteUnifiedType(index: number): boolean {
    if (!commonConfig.value?.unified_types || !Number.isInteger(index) || !config().unified_types![index]) return false
    // Preserve the existing semantics: deleting a type does not delete fields.
    commit('history.deleteUnifiedType', [spliceChange(() => config().unified_types!, index, 1)])
    showToast(t('toast.unifiedTypeDeleted'))
    return true
  }

  function renameUnifiedType(oldName: string, newName: string): boolean {
    if (!commonConfig.value) return false
    const index = config().unified_types?.findIndex(type => type.name === oldName) ?? -1
    if (index < 0) return false
    const name = newName.trim()
    if (!name) { showToast(t('toast.unifiedTypeNameEmpty')); return false }
    if (oldName === name) return false
    if (config().unified_types!.some(type => type.name === name)) { showToast(t('toast.unifiedTypeExists', { name })); return false }
    const changes = [propertyChange(() => config().unified_types![index]!, 'name', name)]
    const files: AffectedFile[] = commonSqlFiles()
    for (const schema of schemas) {
      for (const table of schema.tables) {
        const schemaName = schema.schema
        const tableName = table.name
        const get = () => schemas.find(item => item.schema === schemaName)!.tables.find(item => item.name === tableName)!
        let affected = false
        table.fields.forEach((field, position) => {
          if (field.unified_type !== oldName) return
          changes.push(propertyChange(() => get().fields[position]!, 'unified_type', name))
          affected = true
        })
        if (affected) files.push(affectedTable(schemaName, tableName))
      }
    }
    for (const key of Object.keys(config().common_used_fields)) {
      if (config().common_used_fields[key]!.unified_type === oldName) changes.push(propertyChange(() => config().common_used_fields[key]!, 'unified_type', name))
    }
    return commit('history.renameUnifiedType', changes, files)
  }

  function updateUnifiedType(name: string, patch: Partial<Omit<UnifiedTypeDefinition, 'name' | SqlDialect>>, coalesce = false): boolean {
    if (!commonConfig.value?.unified_types?.some(type => type.name === name)) return false
    if (['name', 'mysql', 'postgresql', 'sqlite'].some(key => owns(patch, key))) return false
    const get = () => config().unified_types!.find(type => type.name === name)!
    const keys = Object.keys(patch) as (keyof typeof patch)[]
    return commit('history.editUnifiedTypes', keys.map(key => propertyChange(get, key, patch[key])), commonSqlFiles(), coalesce ? JSON.stringify(['unified-type', name, keys.sort()]) : undefined)
  }

  function setUnifiedTypeMappingValue(name: string, db: SqlDialect, key: keyof UnifiedTypeDbMapping, raw: string): boolean {
    if (!commonConfig.value?.unified_types?.some(type => type.name === name)) return false
    const get = () => config().unified_types!.find(type => type.name === name)!
    const next = clone(get()[db] ?? { type: '' })
    if (key === 'type') next.type = raw
    else {
      const value = key === 'length' ? parseFieldLengthInput(raw) : parseFieldScaleInput(raw)
      if (value === null || value === undefined) delete next[key]
      else next[key] = value
    }
    const after = db === 'sqlite' && !next.type && next.length == null && next.scale == null ? undefined : next
    return commit('history.editUnifiedTypes', [propertyChange(get, db, after)], commonSqlFiles(), JSON.stringify(['unified-type-mapping', name, db, key]))
  }

  function moveUnifiedType(from: number, to: number): boolean {
    if (!commonConfig.value?.unified_types) return false
    const before = config().unified_types!.map(type => type.name)
    if (!validMove(before.length, from, to)) return false
    const after = [...before]
    after.splice(to, 0, after.splice(from, 1)[0]!)
    const write = (order: string[]) => {
      const types = new Map(config().unified_types!.map(type => [type.name, type]))
      config().unified_types = order.map(name => types.get(name)!)
    }
    return commit('history.editUnifiedTypes', [{ changed: true, apply: () => write(after), revert: () => write(before) }], [affectedCommon()])
  }

  return {
    setGlobalPreSql, setGlobalPostSql, setProjectName, setProjectDescription,
    getCommonMysqlEngine, getCommonMysqlCharset, getCommonMysqlCollation,
    setCommonMysqlEngine, setCommonMysqlCharset, setCommonMysqlCollation,
    getCommonPostgresqlQuoteIdentifiers, setCommonPostgresqlQuoteIdentifiers,
    getCommonSqliteQuoteIdentifiers, setCommonSqliteQuoteIdentifiers,
    getTableDdlMode, setTableDdlMode, getLogicalDelete, setLogicalDelete,
    getCommonTypeCase, setCommonTypeCase,
    addCommonUsedField, deleteCommonUsedField, updateCommonUsedFieldName,
    updateCommonUsedField, setCommonUsedFieldOverrideValue, moveCommonUsedField, getOrderedCommonUsedFields,
    addUnifiedType, deleteUnifiedType, renameUnifiedType,
    updateUnifiedType, setUnifiedTypeMappingValue, moveUnifiedType,
  }
}
