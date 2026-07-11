import type { Ref, ComputedRef } from 'vue'
import type { CommonConfig, Schema, Table, Field, Index, TableMysqlConfig, InitialData } from '@/types/schema'
import type { SqlDialect } from '@/utils/sql-generator/shared'
import {
  affectedDatabase,
  affectedSchema,
  affectedTable,
  affectedInitialData,
  affectedCommon,
  affectedSql,
  type Command,
  type AffectedFile,
} from '@/core/history/command'
import { newFieldId, newTableId, newSchemaId, newIndexId } from '@/core/ids'
import { sanitizeName } from '@/core/workspace/layout'
import { getDialectSubConfig } from '@/utils/dialect-resolver'
import { resolveFieldTypeForDialect } from '@/utils/sql-generator/shared'
import { formatIndexColumn } from '@/utils/index-column-utils'
import { parseFieldLengthInput } from '@/utils/file-helpers'

export interface CrudDeps {
  schemas: Schema[]
  commonConfig: Ref<CommonConfig | null>
  selectedSchemaIdx: Ref<number>
  selectedTableIdx: Ref<number>
  expandedFields: Set<string>
  expandedIndexes: Set<string>
  showCommonPanel: Ref<boolean>
  settingsTab: Ref<'global' | 'structure' | 'version' | 'project'>
  addFieldSchemaIdx: Ref<number>
  addFieldTableIdx: Ref<number>
  addFieldMode: Ref<'normal' | 'common'>
  newFieldName: Ref<string>
  newFieldSelectCommon: Ref<string>
  newFieldSelectCommons: Ref<string[]>
  newFieldUnifiedType: Ref<string>
  showAddFieldModal: Ref<boolean>
  initialDataMap: Map<string, InitialData>
  initialDataDeletedKeys: Set<string>
  currentSchema: ComputedRef<Schema | null | undefined>
  initialDataKey: (schemaName: string, tableName: string) => string
  executeCommand: (cmd: Command) => void
  showToast: (msg: string) => void
  t: (key: string, options?: any) => string
}

export function createCrudActions(deps: CrudDeps) {
  const {
    schemas,
    commonConfig,
    selectedSchemaIdx,
    selectedTableIdx,
    expandedFields,
    expandedIndexes,
    showCommonPanel,
    settingsTab,
    addFieldSchemaIdx,
    addFieldTableIdx,
    addFieldMode,
    newFieldName,
    newFieldSelectCommon,
    newFieldSelectCommons,
    newFieldUnifiedType,
    showAddFieldModal,
    initialDataMap,
    initialDataDeletedKeys,
    currentSchema,
    initialDataKey,
    executeCommand,
    showToast,
    t,
  } = deps

  // ===== Schema Order =====
  /** 将当前 schemas 顺序同步到 commonConfig.schema_order */
  function syncSchemaOrder() {
    if (!commonConfig.value) return
    commonConfig.value.schema_order = schemas.map(s => s.schema)
  }

  /** 按 schema_order 排序 schemas（未在列表中的保留在原位，即末尾） */
  function applySchemaOrder() {
    const order = commonConfig.value?.schema_order
    if (!order || order.length === 0) return
    const orderMap = new Map<string, number>()
    order.forEach((name, i) => orderMap.set(name, i))
    schemas.sort((a, b) => {
      const ai = orderMap.get(a.schema)
      const bi = orderMap.get(b.schema)
      if (ai === undefined && bi === undefined) return 0
      if (ai === undefined) return 1
      if (bi === undefined) return -1
      return ai - bi
    })
  }

  /** 拖拽调整 schema 顺序 */
  function moveSchema(fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return
    if (fromIdx < 0 || fromIdx >= schemas.length) return
    if (toIdx < 0 || toIdx >= schemas.length) return
    const [schema] = schemas.splice(fromIdx, 1)
    if (!schema) return
    executeCommand({
      label: t('history.moveSchema'),
      coalesceKey: `move-schema:${fromIdx}-${toIdx}`,
      apply() {
        schemas.splice(toIdx, 0, schema)
        syncSchemaOrder()
      },
      revert() {
        const curIdx = schemas.indexOf(schema)
        if (curIdx >= 0) schemas.splice(curIdx, 1)
        schemas.splice(fromIdx, 0, schema)
        syncSchemaOrder()
      },
      affectedFiles() {
        return [affectedDatabase(), affectedSql()]
      },
    })
  }

  // ===== Schema CRUD =====

  function addSchema(name: string) {
    if (schemas.some(s => s.schema === name)) {
      showToast(t('toast.schemaExists', { name }))
      return
    }
    const newSchema: Schema = {
      schema: name,
      tables: []
    }
    // 新增 schema 自动带 id（无论是否已创建基线，保证可跨版本识别）
    newSchema.schema_id = newSchemaId()
    executeCommand({
      label: t('history.addSchema'),
      coalesceKey: `add-schema:${name}`,
      apply() {
        schemas.push(newSchema)
        syncSchemaOrder()
      },
      revert() {
        const idx = schemas.indexOf(newSchema)
        if (idx >= 0) schemas.splice(idx, 1)
      },
      affectedFiles() {
        return [affectedDatabase(), affectedSchema(name), affectedSql()]
      },
    })
    selectedSchemaIdx.value = schemas.length - 1
    selectedTableIdx.value = -1
    showToast(t('toast.schemaCreated'))
  }

  function deleteSchema(schemaIdx: number) {
    const schema = schemas[schemaIdx]
    if (!schema) return
    if (!confirm(t('confirm.deleteSchema', { name: schema.schema }))) return

    // 记录该 schema 下各表的 initial-data 状态，便于 revert 恢复
    const removedInitialData: { key: string; data: InitialData }[] = []
    for (const table of schema.tables) {
      const key = initialDataKey(schema.schema, table.name)
      if (initialDataMap.has(key)) {
        removedInitialData.push({ key, data: initialDataMap.get(key)! })
      }
    }
    const removedIdx = schemaIdx
    const removedSchema = schema

    executeCommand({
      label: t('history.deleteSchema', { name: removedSchema.schema }),
      coalesceKey: `delete-schema:${removedSchema.schema}`,
      apply() {
        // 标记该 schema 所有 initial-data 待删除
        for (const { key } of removedInitialData) {
          if (initialDataMap.has(key)) {
            initialDataMap.delete(key)
            initialDataDeletedKeys.add(key)
          }
        }
        const idx = schemas.indexOf(removedSchema)
        if (idx >= 0) schemas.splice(idx, 1)
        syncSchemaOrder()
        // 更新选中
        if (schemas.length === 0) {
          selectedSchemaIdx.value = -1
          selectedTableIdx.value = -1
        } else if (selectedSchemaIdx.value >= schemas.length) {
          selectedSchemaIdx.value = schemas.length - 1
        }
      },
      revert() {
        schemas.splice(removedIdx, 0, removedSchema)
        syncSchemaOrder()
        for (const { key, data } of removedInitialData) {
          initialDataMap.set(key, data)
          initialDataDeletedKeys.delete(key)
        }
        selectedSchemaIdx.value = removedIdx
        selectedTableIdx.value = removedSchema.tables.length > 0 ? 0 : -1
      },
      affectedFiles() {
        return [affectedDatabase(), affectedSchema(removedSchema.schema), affectedSql()]
      },
    })
    showToast(t('toast.schemaDeleted'))
  }

  function renameSchema(schemaIdx: number, newName: string) {
    const schema = schemas[schemaIdx]
    if (!schema) return
    newName = newName.trim()
    if (!newName) return
    if (schemas.some((s, i) => i !== schemaIdx && s.schema === newName)) {
      showToast(t('toast.schemaExists', { name: newName }))
      return
    }

    const oldName = schema.schema
    // 记录该 schema 下各表 initial-data key 的迁移，便于 revert
    const keyMigrations = schema.tables.map(table => ({
      oldKey: initialDataKey(oldName, table.name),
      newKey: initialDataKey(newName, table.name),
      data: initialDataMap.has(initialDataKey(oldName, table.name))
        ? initialDataMap.get(initialDataKey(oldName, table.name))!
        : undefined,
    }))

    executeCommand({
      label: t('history.renameSchema', { name: newName }),
      coalesceKey: `rename-schema:${oldName}`,
      apply() {
        schema.schema = newName
        syncSchemaOrder()
        for (const m of keyMigrations) {
          if (m.data !== undefined) {
            initialDataMap.delete(m.oldKey)
            initialDataMap.set(m.newKey, m.data)
          }
          initialDataDeletedKeys.add(m.oldKey)
        }
      },
      revert() {
        schema.schema = oldName
        syncSchemaOrder()
        for (const m of keyMigrations) {
          if (m.data !== undefined) {
            initialDataMap.delete(m.newKey)
            initialDataMap.set(m.oldKey, m.data)
          }
          initialDataDeletedKeys.delete(m.oldKey)
        }
      },
      affectedFiles() {
        const files: AffectedFile[] = [
          affectedDatabase(),
          { kind: 'schema', schema: newName, oldSchema: oldName },
          affectedSql(),
        ]
        for (const table of schema.tables) {
          files.push(affectedTable(newName, table.name))
          files.push(affectedInitialData(newName, table.name))
        }
        return files
      },
    })

    showToast(t('toast.schemaRenamed'))
  }

  // ===== Navigation =====
  function selectTable(schemaIdx: number, tableIdx: number) {
    selectedSchemaIdx.value = schemaIdx
    selectedTableIdx.value = tableIdx
    showCommonPanel.value = false
    // Clear expanded states
    expandedFields.clear()
    expandedIndexes.clear()
  }

  function selectCommonConfig() {
    showCommonPanel.value = true
    selectedSchemaIdx.value = -1
    selectedTableIdx.value = -1
  }

  /** 选中 Schema（不选表），用于显示 SchemaConfigPanel */
  function selectSchemaOnly(schemaIdx: number) {
    showCommonPanel.value = false
    selectedSchemaIdx.value = schemaIdx
    selectedTableIdx.value = -1
    expandedFields.clear()
    expandedIndexes.clear()
  }

  // ===== 项目设置 =====
  /** 切换到指定设置 tab */
  function selectSettingsTab(tab: 'global' | 'structure' | 'version' | 'project') {
    settingsTab.value = tab
    if (tab === 'global') {
      // 全局配置页等价于原来的公共配置面板，需置 showCommonPanel 才能渲染
      showCommonPanel.value = true
    } else {
      showCommonPanel.value = false
    }
  }

  // ===== Table CRUD =====
  function addTable(schemaIdx: number) {
    const schema = schemas[schemaIdx]
    if (!schema) return
    const newTable: Table = {
      name: 'new_table',
      comment: '',
      fields: [],
      indexes: []
    }
    // 新增 table 自动带 id（无论是否已创建基线，保证可跨版本识别）
    newTable.table_id = newTableId()
    executeCommand({
      label: t('history.addTable'),
      coalesceKey: `add-table:${schema.schema}`,
      apply() {
        schema.tables.push(newTable)
      },
      revert() {
        const idx = schema.tables.indexOf(newTable)
        if (idx >= 0) schema.tables.splice(idx, 1)
      },
      affectedFiles() {
        return [affectedSchema(schema.schema), affectedTable(schema.schema, newTable.name), affectedSql()]
      },
    })
    selectTable(schemaIdx, schema.tables.length - 1)
    showToast(t('toast.tableAdded'))
  }

  /** 重命名表：同步更新表名、迁移初始数据 key 并清理旧表目录 */
  function renameTable(schemaIdx: number, tableIdx: number, newName: string): boolean {
    const schema = schemas[schemaIdx]
    if (!schema) return false
    const table = schema.tables[tableIdx]
    if (!table) return false
    newName = newName.trim()
    if (!newName) return false
    if (schema.tables.some((t, i) => i !== tableIdx && t.name === newName)) {
      showToast(t('toast.tableExists', { name: newName }))
      return false
    }

    const oldName = table.name
    const oldKey = initialDataKey(schema.schema, oldName)
    const newKey = initialDataKey(schema.schema, newName)
    const movedData = initialDataMap.has(oldKey) ? initialDataMap.get(oldKey)! : undefined
    // 仅当旧表目录与新目录经 sanitize 后不同名时，才标记旧 key 待删除（避免
    // 大小写不敏感文件系统上误删同一物理目录）。
    const markOldKeyForDelete = sanitizeName(oldName) !== sanitizeName(newName)

    executeCommand({
      label: t('history.renameTable', { name: newName }),
      coalesceKey: `rename-table:${schema.schema}:${oldName}`,
      apply() {
        if (movedData !== undefined) {
          initialDataMap.delete(oldKey)
          initialDataMap.set(newKey, movedData)
        }
        if (markOldKeyForDelete) {
          initialDataDeletedKeys.add(oldKey)
        }
        table.name = newName
      },
      revert() {
        if (movedData !== undefined) {
          initialDataMap.delete(newKey)
          initialDataMap.set(oldKey, movedData)
        }
        if (markOldKeyForDelete) {
          initialDataDeletedKeys.delete(oldKey)
        }
        table.name = oldName
      },
      affectedFiles() {
        return [
          affectedSchema(schema.schema),
          affectedTable(schema.schema, newName),
          affectedInitialData(schema.schema, newName),
          affectedSql(),
        ]
      },
    })

    showToast(t('toast.tableRenamed'))
    return true
  }

  async function deleteTable(schemaIdx: number, tableIdx: number) {
    const schema = schemas[schemaIdx]
    if (!schema) return
    const tableName = schema.tables[tableIdx]?.name
    if (!confirm(t('confirm.deleteTable', { name: tableName }))) return

    const removedTable = schema.tables[tableIdx]
    if (!removedTable) return
    const removedIdx = tableIdx
    // 记录被删表的 initial-data 状态，便于 revert 恢复
    const dataKey = initialDataKey(schema.schema, removedTable.name)
    const removedInitialData = initialDataMap.has(dataKey)
      ? { key: dataKey, data: initialDataMap.get(dataKey)! }
      : null

    executeCommand({
      label: t('history.deleteTable', { name: removedTable.name }),
      coalesceKey: `delete-table:${schema.schema}:${removedTable.name}`,
      apply() {
        if (removedIdx < schema.tables.length) {
          schema.tables.splice(removedIdx, 1)
        }
        if (removedInitialData) {
          initialDataMap.delete(removedInitialData.key)
          initialDataDeletedKeys.add(removedInitialData.key)
        }
      },
      revert() {
        schema.tables.splice(removedIdx, 0, removedTable)
        if (removedInitialData) {
          initialDataMap.set(removedInitialData.key, removedInitialData.data)
          initialDataDeletedKeys.delete(removedInitialData.key)
        }
      },
      affectedFiles() {
        return [affectedSchema(schema.schema), affectedTable(schema.schema, removedTable.name), affectedInitialData(schema.schema, removedTable.name), affectedSql()]
      },
    })

    if (selectedSchemaIdx.value === schemaIdx) {
      if (selectedTableIdx.value >= schema.tables.length) {
        selectedTableIdx.value = schema.tables.length - 1
      }
      if (schema.tables.length === 0) {
        selectedTableIdx.value = -1
      }
    }
    showToast(t('toast.tableDeleted'))
  }

  /** 拖拽调整同一个 schema 下表的顺序 */
  function moveTable(schemaIdx: number, fromIdx: number, toIdx: number) {
    const schema = schemas[schemaIdx]
    if (!schema) return
    if (fromIdx === toIdx) return
    if (fromIdx < 0 || fromIdx >= schema.tables.length) return
    if (toIdx < 0 || toIdx > schema.tables.length) return

    const [table] = schema.tables.splice(fromIdx, 1)
    if (!table) return
    const insertIdx = toIdx > fromIdx ? toIdx - 1 : toIdx
    executeCommand({
      label: t('history.moveTable'),
      coalesceKey: `move-table:${schema.schema}:${fromIdx}-${toIdx}`,
      apply() {
        schema.tables.splice(insertIdx, 0, table)
        if (selectedSchemaIdx.value === schemaIdx && selectedTableIdx.value === fromIdx) {
          selectedTableIdx.value = insertIdx
        }
      },
      revert() {
        const curIdx = schema.tables.indexOf(table)
        if (curIdx >= 0) schema.tables.splice(curIdx, 1)
        schema.tables.splice(fromIdx, 0, table)
        if (selectedSchemaIdx.value === schemaIdx && selectedTableIdx.value === insertIdx) {
          selectedTableIdx.value = fromIdx
        }
      },
      affectedFiles() {
        return [affectedSchema(schema.schema), affectedSql()]
      },
    })
  }

  /** 跨 schema 拖拽移动表 */
  function moveTableToSchema(fromSchemaIdx: number, fromTableIdx: number, toSchemaIdx: number, toTableIdx: number) {
    const fromSchema = schemas[fromSchemaIdx]
    const toSchema = schemas[toSchemaIdx]
    if (!fromSchema || !toSchema) return
    if (fromTableIdx < 0 || fromTableIdx >= fromSchema.tables.length) return
    if (toTableIdx < 0 || toTableIdx > toSchema.tables.length) return

    // 同一个 schema 内移动，委托给 moveTable
    if (fromSchemaIdx === toSchemaIdx) {
      moveTable(fromSchemaIdx, fromTableIdx, toTableIdx)
      return
    }

    const [table] = fromSchema.tables.splice(fromTableIdx, 1)
    if (!table) return
    toSchema.tables.splice(toTableIdx, 0, table)

    // Update initial data key when table moves between schemas
    const oldKey = initialDataKey(fromSchema.schema, table.name)
    const newKey = initialDataKey(toSchema.schema, table.name)
    const movedData = initialDataMap.has(oldKey) ? initialDataMap.get(oldKey)! : undefined

    executeCommand({
      label: t('history.moveTableToSchema'),
      coalesceKey: `move-table-to-schema:${fromSchema.schema}-${toSchema.schema}:${table.name}`,
      apply() {
        if (movedData !== undefined) {
          initialDataMap.delete(oldKey)
          initialDataMap.set(newKey, movedData)
        }
        selectedSchemaIdx.value = toSchemaIdx
        selectedTableIdx.value = toTableIdx
      },
      revert() {
        const curIdx = toSchema.tables.indexOf(table)
        if (curIdx >= 0) toSchema.tables.splice(curIdx, 1)
        fromSchema.tables.splice(fromTableIdx, 0, table)
        if (movedData !== undefined) {
          initialDataMap.delete(newKey)
          initialDataMap.set(oldKey, movedData)
        }
        selectedSchemaIdx.value = fromSchemaIdx
        selectedTableIdx.value = fromTableIdx
      },
      affectedFiles() {
        return [
          affectedSchema(fromSchema.schema),
          affectedSchema(toSchema.schema),
          affectedTable(toSchema.schema, table.name),
          affectedInitialData(toSchema.schema, table.name),
          affectedSql(),
        ]
      },
    })
  }

  // ===== Field Helpers =====
  function isCommonField(field: Field) {
    return field.use_common_used_fields === true
  }

  function getResolvedField(field: Field): Field {
    if (isCommonField(field) && commonConfig.value) {
      return commonConfig.value.common_used_fields[field.field_name] || field
    }
    return field
  }

  function fieldKey(schema: Schema, table: Table, field: Field) {
    return `${schema.schema}-${table.name}-${field.field_name}`
  }

  function indexKey(schema: Schema, table: Table, index: Index, indexIdx: number) {
    return `${schema.schema}-${table.name}-idx-${index.name || indexIdx}`
  }

  function toggleFieldExpand(key: string) {
    if (expandedFields.has(key)) {
      expandedFields.delete(key)
    } else {
      expandedFields.add(key)
    }
  }

  function toggleIndexExpand(key: string) {
    if (expandedIndexes.has(key)) {
      expandedIndexes.delete(key)
    } else {
      expandedIndexes.add(key)
    }
  }

  /** 获取字段在指定数据库方言中最终解析的类型显示字符串（如 "VARCHAR(255)" 或 "DECIMAL(10,2)"） */
  function getResolvedFieldTypeForDb(field: Field, dialect: SqlDialect): string {
    const resolved = getResolvedField(field)
    const typeInfo = resolveFieldTypeForDialect(resolved, dialect, commonConfig.value)
    if (!typeInfo.type) return '-'
    if (typeof typeInfo.scale === 'number' && typeof typeInfo.length === 'number') {
      return `${typeInfo.type}(${typeInfo.length},${typeInfo.scale})`
    }
    if (typeInfo.length !== null && typeInfo.length !== undefined) {
      return `${typeInfo.type}(${typeInfo.length})`
    }
    return typeInfo.type
  }

  /** 返回字段在 FieldTable type 列的显示文本 */
  function fieldTypeDisplay(field: Field): string {
    const resolved = getResolvedField(field)
    if (resolved.unified_type) return resolved.unified_type
    return resolved.field_type || '-'
  }

  /** 检查字段（含公共字段解析）是否包含任何数据库方言覆盖 */
  function hasFieldOverrides(field: Field): boolean {
    const resolved = getResolvedField(field)
    const m = resolved.mysql
    const p = resolved.postgresql
    return (!!m && Object.keys(m).length > 0) || (!!p && Object.keys(p).length > 0)
  }

  /** 解析字段默认值是否需要引号包裹 */
  function quoteDefaultForField(field: Field): boolean {
    const resolved = getResolvedField(field)
    // 字段级显式设置优先
    if (resolved.quote_default !== undefined) return resolved.quote_default
    // 从 unified_type 定义中获取
    if (resolved.unified_type && commonConfig.value?.unified_types) {
      const def = commonConfig.value.unified_types.find(ut => ut.name === resolved.unified_type)
      if (def?.quote_default !== undefined) return def.quote_default
    }
    // 默认不加引号（保持向后兼容，旧数据中 default 值已自带引号）
    return false
  }

  // ===== Comment Before Table =====
  function commentBeforeTableText(table: Table) {
    const val = table.comment_before_table
    if (!val) return ''
    if (Array.isArray(val)) {
      return val.map(item => item === null ? '' : item).join('\n')
    }
    return val
  }

  function setCommentBeforeTable(table: Table, text: string) {
    const lines = text.split('\n')
    const target: string | string[] | undefined = lines.length === 1
      ? (lines[0] === '' ? undefined : lines[0])
      : lines.map(line => line === '' ? null : line) as string[]
    const oldVal = table.comment_before_table

    executeCommand({
      label: t('history.editCommentBeforeTable'),
      coalesceKey: `comment-before-table:${table.name}`,
      apply() {
        if (target === undefined) {
          delete table.comment_before_table
        } else {
          table.comment_before_table = target
        }
      },
      revert() {
        if (oldVal === undefined) {
          delete table.comment_before_table
        } else {
          table.comment_before_table = oldVal
        }
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
  }

  // ===== Comment Before Fields =====
  function commentBeforeFieldText(table: Table, fieldName: string) {
    if (!table.comment_before_fields || !table.comment_before_fields[fieldName]) return ''
    const val = table.comment_before_fields[fieldName]
    if (Array.isArray(val)) {
      return val.map(item => item === null ? '' : item).join('\n')
    }
    return val
  }

  function setCommentBeforeField(table: Table, fieldName: string, text: string) {
    // 计算目标值（与原逻辑一致）
    let target: string | string[] | undefined
    if (text.trim()) {
      const lines = text.split('\n')
      target = lines.length === 1 ? lines[0]! : lines.map(line => line === '' ? null : line) as string[]
    }
    const oldVal = table.comment_before_fields?.[fieldName]
    const oldObj = table.comment_before_fields ? { ...table.comment_before_fields } : undefined

    executeCommand({
      label: t('history.editCommentBeforeField', { name: fieldName }),
      coalesceKey: `comment-before-field:${table.name}:${fieldName}`,
      apply() {
        if (target === undefined) {
          if (table.comment_before_fields) {
            delete table.comment_before_fields[fieldName]
            if (Object.keys(table.comment_before_fields).length === 0) {
              delete table.comment_before_fields
            }
          }
        } else {
          if (!table.comment_before_fields) table.comment_before_fields = {}
          table.comment_before_fields[fieldName] = target
        }
      },
      revert() {
        if (oldVal === undefined) {
          if (table.comment_before_fields) {
            delete table.comment_before_fields[fieldName]
            if (oldObj && Object.keys(oldObj).length === 0) {
              delete table.comment_before_fields
            }
          }
        } else if (oldObj) {
          table.comment_before_fields = { ...oldObj }
        }
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
  }

  // ===== Field CRUD =====
  function openAddFieldModal(schemaIdx: number, tableIdx: number, mode: 'normal' | 'common') {
    addFieldSchemaIdx.value = schemaIdx
    addFieldTableIdx.value = tableIdx
    addFieldMode.value = mode
    newFieldName.value = ''
    newFieldSelectCommon.value = ''
    if (mode === 'common') {
      // 初始化勾选状态：当前表中已引用的公共字段默认勾选
      const table = schemas[schemaIdx]?.tables[tableIdx]
      newFieldSelectCommons.value = table
        ? table.fields.filter(f => f.use_common_used_fields).map(f => f.field_name)
        : []
    }
    showAddFieldModal.value = true
  }

  function confirmAddField() {
    const sIdx = addFieldSchemaIdx.value
    const tIdx = addFieldTableIdx.value
    if (sIdx < 0 || tIdx < 0) return

    const table = schemas[sIdx]?.tables[tIdx]
    if (!table) return

    if (addFieldMode.value === 'common') {
      const selectedNames = newFieldSelectCommons.value
      const existingCommonNames = table.fields
        .filter(f => f.use_common_used_fields)
        .map(f => f.field_name)
      // 删除：表中存在但未被勾选的公共字段引用
      const removed: Field[] = []
      for (let i = table.fields.length - 1; i >= 0; i--) {
        const f = table.fields[i]!
        if (f.use_common_used_fields && !selectedNames.includes(f.field_name)) {
          removed.unshift(f)
          table.fields.splice(i, 1)
        }
      }
      // 添加：勾选了但表中不存在的公共字段引用
      const added: Field[] = []
      for (const name of selectedNames) {
        if (!existingCommonNames.includes(name)) {
          const f: Field = { field_name: name, use_common_used_fields: true }
          added.push(f)
          table.fields.push(f)
        }
      }

      const schemaName = schemas[sIdx]!.schema
      const finalMsg = (() => {
        if (added.length > 0 && removed.length > 0) {
          return t('toast.commonFieldsUpdated', { added: added.length, removed: removed.length })
        } else if (added.length > 0) {
          return t('toast.commonFieldsAdded', { n: added.length })
        } else if (removed.length > 0) {
          return t('toast.commonFieldsRemoved', { n: removed.length })
        }
        return t('toast.noChange')
      })()

      // 记录增删前后的字段数组快照，便于 undo/redo 完整回滚
      const beforeFields = table.fields.filter(f => !added.includes(f))
      const afterFields = table.fields.slice()

      executeCommand({
        label: t('history.editCommonFields'),
        coalesceKey: `edit-common-fields:${table.name}`,
        apply() {
          table.fields.splice(0, table.fields.length, ...afterFields)
        },
        revert() {
          table.fields.splice(0, table.fields.length, ...beforeFields)
        },
        affectedFiles() {
          return [affectedTable(schemaName, table.name), affectedCommon(), affectedSql()]
        },
      })

      showToast(finalMsg)
    } else {
      const name = newFieldName.value.trim()
      if (!name) { showToast(t('toast.pleaseEnterFieldName')); return }
      if (table.fields.some(f => f.field_name === name)) {
        showToast(t('toast.fieldExistsInTable', { name }))
        return
      }
      const ut = newFieldUnifiedType.value || undefined
      const newField: Field = {
        field_name: name,
        // 新增 field 自动带 id（无论是否已创建基线，保证可跨版本识别）
        field_id: newFieldId(),
        unified_type: ut,
        // 仅当未选择 unified_type 时才预设 field_type/field_length
        field_type: ut ? undefined : 'varchar',
        field_length: ut ? undefined : 255,
        not_null: false,
        primary_key: false,
        comment: ''
      }
      executeCommand({
        label: t('history.addField'),
        coalesceKey: `add-field-named:${table.name}:${name}`,
        apply() {
          table.fields.push(newField)
        },
        revert() {
          const idx = table.fields.indexOf(newField)
          if (idx >= 0) table.fields.splice(idx, 1)
        },
        affectedFiles() {
          return [affectedTable(schemas[sIdx]!.schema, table.name), affectedSql()]
        },
      })
      showToast(t('toast.fieldAdded'))
    }

    showAddFieldModal.value = false
  }

  function directAddField(schemaIdx: number, tableIdx: number) {
    if (schemaIdx < 0 || tableIdx < 0) return
    const table = schemas[schemaIdx]?.tables[tableIdx]
    if (!table) return

    const newField: Field = {
      field_name: '',
      field_type: 'varchar',
      field_length: 255,
      not_null: false,
      primary_key: false,
      comment: ''
    }
    // 新增 field 自动带 id（无论是否已创建基线，保证可跨版本识别）
    newField.field_id = newFieldId()
    executeCommand({
      label: t('history.addField'),
      coalesceKey: `add-field:${table.name}`,
      apply() {
        table.fields.push(newField)
      },
      revert() {
        const idx = table.fields.indexOf(newField)
        if (idx >= 0) table.fields.splice(idx, 1)
      },
      affectedFiles() {
        return [affectedTable(schemas[schemaIdx]!.schema, table.name), affectedSql()]
      },
    })
    showToast(t('toast.fieldAdded'))
  }

  function deleteField(table: Table, fieldIdx: number) {
    const fieldName = table.fields[fieldIdx]?.field_name
    // 空字段名直接删除，不限确认
    if (fieldName && !confirm(t('confirm.deleteField', { name: fieldName }))) return

    const removed = table.fields[fieldIdx]
    if (!removed) return
    const removedIdx = fieldIdx
    // 删除 comment_before_fields 中该字段的注释（revert 时一并恢复）
    const removedCommentBefore = fieldName && table.comment_before_fields
      ? { ...table.comment_before_fields }
      : undefined

    executeCommand({
      label: t('history.deleteField', { name: fieldName || '' }),
      coalesceKey: `delete-field:${table.name}:${fieldIdx}`,
      apply() {
        table.fields.splice(removedIdx, 1)
        if (fieldName && table.comment_before_fields && table.comment_before_fields[fieldName]) {
          delete table.comment_before_fields[fieldName]
          if (Object.keys(table.comment_before_fields).length === 0) {
            delete table.comment_before_fields
          }
        }
      },
      revert() {
        table.fields.splice(removedIdx, 0, removed)
        if (removedCommentBefore) {
          table.comment_before_fields = removedCommentBefore
        }
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
    showToast(t('toast.fieldDeleted'))
  }

  /** 从表对象反查其所属 schema 名称（用于 affectedFiles） */
  function currentSchemaName(table: Table): string {
    const schema = schemas.find(s => s.tables.includes(table))
    return schema?.schema ?? currentSchema.value?.schema ?? ''
  }

  /** 从字段对象反查其所属 schema 名称（用于 affectedFiles） */
  function currentSchemaNameOfField(field: Field): string {
    for (const schema of schemas) {
      for (const table of schema.tables) {
        if (table.fields.includes(field)) {
          return schema.schema
        }
      }
    }
    return currentSchema.value?.schema ?? ''
  }

  /**
   * 通用字段属性编辑命令：apply 设为新值，revert 恢复旧值。
   * 用于字段名/注释/类型/长度/默认值/skip 等所有字段属性编辑，统一支持 undo/redo。
   * 同一字段同一属性的连续编辑通过 coalesceKey 合并为单条 undo 记录。
   */
  function updateFieldProp(
    table: Table,
    field: Field,
    prop: keyof Field,
    value: unknown,
    coalesceKey?: string,
  ) {
    const oldValue = field[prop]
    if (oldValue === value) return
    executeCommand({
      label: t('history.editField', { prop: String(prop) }),
      coalesceKey: coalesceKey ?? `field-prop:${table.name}:${field.field_name}:${String(prop)}`,
      apply() {
        ;(field as any)[prop] = value
      },
      revert() {
        ;(field as any)[prop] = oldValue
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
  }

  /** 一次性更新字段多个属性（如切换统一类型时清 field_type/quote_default），作为一个撤销单元 */
  function updateFieldProps(
    table: Table,
    field: Field,
    changes: Partial<Field>,
    coalesceKey?: string,
  ) {
    const oldValues: Partial<Field> = {}
    for (const k of Object.keys(changes) as (keyof Field)[]) {
      ;(oldValues as any)[k] = field[k]
    }
    executeCommand({
      label: t('history.editField', { prop: 'multiple' }),
      coalesceKey: coalesceKey ?? `field-props:${table.name}:${field.field_name}`,
      apply() {
        Object.assign(field, changes)
      },
      revert() {
        Object.assign(field, oldValues)
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
  }

  /** 字段名编辑命令：改名后同步索引中引用的列名 */
  function updateFieldName(table: Table, field: Field, newName: string) {
    const oldName = field.field_name
    const trimmed = newName.trim()
    if (!trimmed || oldName === trimmed) return
    executeCommand({
      label: t('history.renameField', { name: trimmed }),
      coalesceKey: `rename-field:${table.name}:${oldName}`,
      apply() {
        field.field_name = trimmed
        syncFieldNameInIndexes(table, oldName, trimmed)
      },
      revert() {
        field.field_name = oldName
        syncFieldNameInIndexes(table, trimmed, oldName)
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
  }

  function moveFieldUp(table: Table, fieldIdx: number) {
    if (fieldIdx <= 0) return
    const fromIdx = fieldIdx
    const toIdx = fieldIdx - 1
    executeCommand({
      label: t('history.moveField'),
      coalesceKey: `move-field:${table.name}:${fieldIdx}`,
      apply() {
        const arr = table.fields
        ;[arr[toIdx], arr[fromIdx]] = [arr[fromIdx]!, arr[toIdx]!]
      },
      revert() {
        const arr = table.fields
        ;[arr[fromIdx], arr[toIdx]] = [arr[toIdx]!, arr[fromIdx]!]
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
  }

  function moveFieldDown(table: Table, fieldIdx: number) {
    if (fieldIdx >= table.fields.length - 1) return
    const fromIdx = fieldIdx
    const toIdx = fieldIdx + 1
    executeCommand({
      label: t('history.moveField'),
      coalesceKey: `move-field:${table.name}:${fieldIdx}`,
      apply() {
        const arr = table.fields
        ;[arr[toIdx], arr[fromIdx]] = [arr[fromIdx]!, arr[toIdx]!]
      },
      revert() {
        const arr = table.fields
        ;[arr[fromIdx], arr[toIdx]] = [arr[toIdx]!, arr[fromIdx]!]
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
  }

  // ===== Index CRUD =====
  function addIndex(table: Table) {
    const newIndex: Index = {
      type: 'index',
      // 新增 index 自动带 id（无论是否已创建基线，保证可跨版本识别）
      index_id: newIndexId(),
      columns: [{ name: '' }],
      using: ''
    }
    executeCommand({
      label: t('history.addIndex'),
      apply() {
        table.indexes.push(newIndex)
      },
      revert() {
        const idx = table.indexes.indexOf(newIndex)
        if (idx >= 0) table.indexes.splice(idx, 1)
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
    showToast(t('toast.indexAdded'))
  }

  function deleteIndex(table: Table, indexIdx: number) {
    if (!confirm(t('confirm.deleteIndex'))) return
    const removed = table.indexes[indexIdx]
    if (!removed) return
    executeCommand({
      label: t('history.deleteIndex'),
      apply() {
        if (indexIdx >= 0 && indexIdx < table.indexes.length) {
          table.indexes.splice(indexIdx, 1)
        }
      },
      revert() {
        table.indexes.splice(indexIdx, 0, removed)
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
    showToast(t('toast.indexDeleted'))
  }

  /** 当字段名变更时，同步更新所有索引中引用的列名 */
  function syncFieldNameInIndexes(table: Table, oldName: string, newName: string) {
    if (!oldName || !newName || oldName === newName) return
    for (const index of table.indexes) {
      for (const col of index.columns) {
        if (col.name === oldName) {
          col.name = newName
        }
      }
    }
  }

  function indexColumnsText(index: Index) {
    return (index.columns || []).map(c => formatIndexColumn(c)).filter(s => s).join(', ')
  }

  function setIndexColumns(index: Index, text: string) {
    const raw = text.split(',').map(s => s.trim()).filter(s => s)
    const newColumns = raw.length > 0 ? raw.map(s => ({ name: s })) : [{ name: '' }]
    const oldColumns = index.columns.map(c => ({ ...c }))
    executeCommand({
      label: t('history.editIndexColumns'),
      coalesceKey: `index-cols:${index.name ?? ''}`,
      apply() {
        index.columns = newColumns
      },
      revert() {
        index.columns = oldColumns.map(c => ({ ...c }))
      },
      affectedFiles() {
        const owner = schemas.find(s => s.tables.some(t => t.indexes.includes(index)))
        const table = owner?.tables.find(t => t.indexes.includes(index))
        return (owner && table)
          ? [affectedTable(owner.schema, table.name), affectedSql()]
          : [affectedSql()]
      },
    })
  }

  // ===== MySQL table override =====
  function getTableMysqlEngine(table: Table) {
    return getDialectSubConfig(table.mysql, 'mysql_engine', '')
  }
  function getTableMysqlCharset(table: Table) {
    return getDialectSubConfig(table.mysql, 'mysql_charset', '')
  }
  function getTableMysqlCollation(table: Table) {
    return getDialectSubConfig(table.mysql, 'mysql_collation', '')
  }
  function setTableMysqlEngine(table: Table, val: string) {
    const oldMysql = table.mysql ? { ...table.mysql } : undefined
    executeCommand({
      label: t('history.editTableMysqlEngine'),
      coalesceKey: `table-mysql-engine:${table.name}`,
      apply() {
        if (!table.mysql) table.mysql = {}
        table.mysql.mysql_engine = val || undefined
        cleanMysqlOverride(table)
      },
      revert() {
        if (oldMysql) {
          table.mysql = { ...oldMysql }
        } else {
          delete table.mysql
        }
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
  }
  function setTableMysqlCharset(table: Table, val: string) {
    const oldMysql = table.mysql ? { ...table.mysql } : undefined
    executeCommand({
      label: t('history.editTableMysqlCharset'),
      coalesceKey: `table-mysql-charset:${table.name}`,
      apply() {
        if (!table.mysql) table.mysql = {}
        table.mysql.mysql_charset = val || undefined
        cleanMysqlOverride(table)
      },
      revert() {
        if (oldMysql) {
          table.mysql = { ...oldMysql }
        } else {
          delete table.mysql
        }
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
  }
  function setTableMysqlCollation(table: Table, val: string) {
    const oldMysql = table.mysql ? { ...table.mysql } : undefined
    executeCommand({
      label: t('history.editTableMysqlCollation'),
      coalesceKey: `table-mysql-collation:${table.name}`,
      apply() {
        if (!table.mysql) table.mysql = {}
        table.mysql.mysql_collation = val || undefined
        cleanMysqlOverride(table)
      },
      revert() {
        if (oldMysql) {
          table.mysql = { ...oldMysql }
        } else {
          delete table.mysql
        }
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
  }
  function cleanMysqlOverride(table: Table) {
    if (table.mysql && Object.values(table.mysql).every(v => v === undefined || v === '')) {
      delete table.mysql
    }
  }

  // ===== Table Pre/Post SQL =====

  function setTablePreSql(table: Table, dialect: SqlDialect, val: string) {
    const trimmed = val.trim()
    if (!trimmed && !table.pre_sql) return
    const oldPreSql = table.pre_sql ? { ...table.pre_sql } : undefined
    executeCommand({
      label: t('history.editTablePreSql', { dialect }),
      coalesceKey: `table-pre-sql:${table.name}:${dialect}`,
      apply() {
        if (!table.pre_sql) table.pre_sql = {}
        if (trimmed) {
          table.pre_sql[dialect] = trimmed
        } else {
          delete table.pre_sql[dialect]
        }
        if (table.pre_sql && !table.pre_sql.mysql && !table.pre_sql.postgresql) {
          delete table.pre_sql
        }
      },
      revert() {
        if (oldPreSql) {
          table.pre_sql = { ...oldPreSql }
        } else {
          delete table.pre_sql
        }
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
  }

  function setTablePostSql(table: Table, dialect: SqlDialect, val: string) {
    const trimmed = val.trim()
    if (!trimmed && !table.post_sql) return
    const oldPostSql = table.post_sql ? { ...table.post_sql } : undefined
    executeCommand({
      label: t('history.editTablePostSql', { dialect }),
      coalesceKey: `table-post-sql:${table.name}:${dialect}`,
      apply() {
        if (!table.post_sql) table.post_sql = {}
        if (trimmed) {
          table.post_sql[dialect] = trimmed
        } else {
          delete table.post_sql[dialect]
        }
        if (table.post_sql && !table.post_sql.mysql && !table.post_sql.postgresql) {
          delete table.post_sql
        }
      },
      revert() {
        if (oldPostSql) {
          table.post_sql = { ...oldPostSql }
        } else {
          delete table.post_sql
        }
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
  }

  // ===== Schema Pre/Post SQL =====

  function setSchemaPreSql(schema: Schema, dialect: SqlDialect, val: string) {
    const trimmed = val.trim()
    if (!trimmed && !schema.pre_sql) return
    const oldPreSql = schema.pre_sql ? { ...schema.pre_sql } : undefined
    executeCommand({
      label: t('history.editSchemaPreSql', { dialect }),
      coalesceKey: `schema-pre-sql:${schema.schema}:${dialect}`,
      apply() {
        if (!schema.pre_sql) schema.pre_sql = {}
        if (trimmed) {
          schema.pre_sql[dialect] = trimmed
        } else {
          delete schema.pre_sql[dialect]
        }
        if (schema.pre_sql && !schema.pre_sql.mysql && !schema.pre_sql.postgresql) {
          delete schema.pre_sql
        }
      },
      revert() {
        if (oldPreSql) {
          schema.pre_sql = { ...oldPreSql }
        } else {
          delete schema.pre_sql
        }
      },
      affectedFiles() {
        return [affectedSchema(schema.schema), affectedSql()]
      },
    })
  }

  function setSchemaPostSql(schema: Schema, dialect: SqlDialect, val: string) {
    const trimmed = val.trim()
    if (!trimmed && !schema.post_sql) return
    const oldPostSql = schema.post_sql ? { ...schema.post_sql } : undefined
    executeCommand({
      label: t('history.editSchemaPostSql', { dialect }),
      coalesceKey: `schema-post-sql:${schema.schema}:${dialect}`,
      apply() {
        if (!schema.post_sql) schema.post_sql = {}
        if (trimmed) {
          schema.post_sql[dialect] = trimmed
        } else {
          delete schema.post_sql[dialect]
        }
        if (schema.post_sql && !schema.post_sql.mysql && !schema.post_sql.postgresql) {
          delete schema.post_sql
        }
      },
      revert() {
        if (oldPostSql) {
          schema.post_sql = { ...oldPostSql }
        } else {
          delete schema.post_sql
        }
      },
      affectedFiles() {
        return [affectedSchema(schema.schema), affectedSql()]
      },
    })
  }

  // ===== Field mysql/postgresql override helpers =====
  function ensureFieldOverride(field: Field, db: SqlDialect) {
    if (!field[db]) field[db] = {}
    return field[db]!
  }

  function getFieldOverrideValue(field: Field, db: SqlDialect, key: string) {
    return (field[db] as any)?.[key] ?? ''
  }

  function setFieldOverrideValue(field: Field, db: SqlDialect, key: string, val: any) {
    const oldOverride = field[db] ? { ...field[db] } : undefined
    const oldDeleted = oldOverride === undefined
    const newVal = (val === '' || val === null || val === undefined)
      ? undefined
      : (key === 'field_length' || key === 'field_scale' ? parseFieldLengthInput(val) : val)

    executeCommand({
      label: t('history.editFieldOverride', { db }),
      coalesceKey: `field-override:${field.field_name}:${db}:${key}`,
      apply() {
        const override = ensureFieldOverride(field, db)
        if (newVal === undefined) {
          delete override[key as keyof typeof override]
        } else {
          (override as any)[key] = newVal
        }
        if (field[db] && Object.keys(field[db]!).length === 0) {
          delete field[db]
        }
      },
      revert() {
        if (oldDeleted) {
          delete field[db]
        } else {
          field[db] = { ...oldOverride! } as any
        }
      },
      affectedFiles() {
        return [affectedTable(currentSchemaNameOfField(field), field.field_name), affectedSql()]
      },
    })
  }

  // ===== Index mysql/postgresql override helpers =====
  function getIndexOverrideValue(index: Index, db: SqlDialect, key: string) {
    return (index[db] as any)?.[key] ?? ''
  }

  function setIndexOverrideValue(index: Index, db: SqlDialect, key: string, val: any) {
    const oldOverride = index[db] ? { ...(index[db] as any) } : undefined
    const oldDeleted = oldOverride === undefined
    const newVal = (val === '' || val === null || val === undefined) ? undefined : val
    executeCommand({
      label: t('history.editIndexOverride'),
      coalesceKey: `index-override:${db}:${key}`,
      apply() {
        if (!index[db]) (index as any)[db] = {}
        if (newVal === undefined) {
          delete (index[db] as any)[key]
        } else {
          (index[db] as any)[key] = newVal
        }
        if (index[db] && Object.keys(index[db]!).length === 0) {
          delete index[db]
        }
      },
      revert() {
        if (oldDeleted) {
          delete index[db]
        } else {
          ;(index as any)[db] = { ...oldOverride! }
        }
      },
      affectedFiles() {
        const owner = schemas.find(s => s.tables.some(t => t.indexes.includes(index)))
        const table = owner?.tables.find(t => t.indexes.includes(index))
        return (owner && table)
          ? [affectedTable(owner.schema, table.name), affectedSql()]
          : [affectedSql()]
      },
    })
  }

  // ===== Build export data =====

  /** 将单表内存态转换为可写出的 table.json 对象 */
  function buildTableExportData(table: Table): Table {
    const tableData: Partial<Table> = {
      name: table.name,
      comment: table.comment,
    }
    // 表唯一 id（创建基线后存在；无基线时为 undefined 不写出）
    if (table.table_id) tableData.table_id = table.table_id

    // comment_before_table
    if (table.comment_before_table) {
      tableData.comment_before_table = table.comment_before_table
    }

    // comment_before_fields
    if (table.comment_before_fields && Object.keys(table.comment_before_fields).length > 0) {
      tableData.comment_before_fields = {}
      for (const [k, v] of Object.entries(table.comment_before_fields)) {
        tableData.comment_before_fields[k] = v
      }
    }

    // pre_sql / post_sql
    if (table.pre_sql && (table.pre_sql.mysql || table.pre_sql.postgresql)) {
      tableData.pre_sql = { ...table.pre_sql }
    }
    if (table.post_sql && (table.post_sql.mysql || table.post_sql.postgresql)) {
      tableData.post_sql = { ...table.post_sql }
    }

    // mysql table config
    if (table.mysql && Object.keys(table.mysql).length > 0) {
      const mysqlData: TableMysqlConfig = {}
      if (table.mysql.mysql_engine) mysqlData.mysql_engine = table.mysql.mysql_engine
      if (table.mysql.mysql_charset) mysqlData.mysql_charset = table.mysql.mysql_charset
      if (table.mysql.mysql_collation) mysqlData.mysql_collation = table.mysql.mysql_collation
      if (Object.keys(mysqlData).length > 0) tableData.mysql = mysqlData
    }

    // fields
    tableData.fields = table.fields.map(field => {
      const f: Field = { field_name: field.field_name }
      // 字段唯一 id（创建基线后存在；无基线时为 undefined 不写出）
      if (field.field_id) f.field_id = field.field_id
      if (field.use_common_used_fields) {
        f.use_common_used_fields = true
      } else {
        // 导出 unified_type（仅当有值时）
        if (field.unified_type) {
          f.unified_type = field.unified_type
          // 有 unified_type 时不导出冗余的 field_type/field_length/field_scale（除非有显式字段级覆盖）
          if (field.field_type !== undefined && field.field_type !== '') f.field_type = field.field_type
          if (field.field_length !== undefined) f.field_length = field.field_length
          if (field.field_scale !== undefined) f.field_scale = field.field_scale
        } else {
          if (field.field_type !== undefined) f.field_type = field.field_type
          if (field.field_length !== undefined) f.field_length = field.field_length
          if (field.field_scale !== undefined) f.field_scale = field.field_scale
        }
        if (field.not_null !== undefined) f.not_null = field.not_null
        if (field.primary_key !== undefined) f.primary_key = field.primary_key
        if (field.default !== undefined) f.default = field.default
        // 仅自定义类型字段导出 quote_default（统一类型字段从类型定义中获取）
        if (!field.unified_type && field.quote_default !== undefined) f.quote_default = field.quote_default
        if (field.comment !== undefined) f.comment = field.comment
        if (field.is_commented_out) f.is_commented_out = true
        if (field.field_length_disabled) f.field_length_disabled = true
        if (field.field_scale_disabled) f.field_scale_disabled = true
        // db overrides
        if (field.mysql && Object.keys(field.mysql).length > 0) f.mysql = { ...field.mysql }
        if (field.postgresql && Object.keys(field.postgresql).length > 0) f.postgresql = { ...field.postgresql }
      }
      return f
    })

    // indexes
    tableData.indexes = table.indexes.map(index => {
      const idx: Partial<Index> = {}
      if (index.name) idx.name = index.name
      if (index.type) idx.type = index.type
      if (index.using) idx.using = index.using
      if (index.index_id) idx.index_id = index.index_id
      idx.columns = index.columns.map(c => {
        const col: any = { name: c.name }
        if (c.sort_order) col.sort_order = c.sort_order
        if (c.mysql && Object.keys(c.mysql).length > 0) col.mysql = { ...c.mysql }
        if (c.postgresql && Object.keys(c.postgresql).length > 0) col.postgresql = { ...c.postgresql }
        return col
      })
      if (index.comment) idx.comment = index.comment
      if (index.pre_comment) idx.pre_comment = index.pre_comment
      if (index.mysql && Object.keys(index.mysql).length > 0) idx.mysql = { ...index.mysql }
      if (index.postgresql && Object.keys(index.postgresql).length > 0) idx.postgresql = { ...index.postgresql }
      return idx as Index
    })

    return tableData as Table
  }

  function buildSchemaExportData(schema: Schema) {
    const data: Schema = {
      schema: schema.schema,
      tables: schema.tables.map(buildTableExportData),
    }
    if (schema.schema_id) data.schema_id = schema.schema_id
    // schema 级别 pre_sql / post_sql
    if (schema.pre_sql && (schema.pre_sql.mysql || schema.pre_sql.postgresql)) {
      data.pre_sql = { ...schema.pre_sql }
    }
    if (schema.post_sql && (schema.post_sql.mysql || schema.post_sql.postgresql)) {
      data.post_sql = { ...schema.post_sql }
    }
    return data
  }

  return {
    syncSchemaOrder,
    applySchemaOrder,
    moveSchema,
    addSchema,
    deleteSchema,
    renameSchema,
    selectTable,
    selectCommonConfig,
    selectSchemaOnly,
    selectSettingsTab,
    addTable,
    renameTable,
    deleteTable,
    moveTable,
    moveTableToSchema,
    isCommonField,
    getResolvedField,
    getResolvedFieldTypeForDb,
    fieldTypeDisplay,
    hasFieldOverrides,
    quoteDefaultForField,
    fieldKey,
    indexKey,
    toggleFieldExpand,
    toggleIndexExpand,
    commentBeforeTableText,
    setCommentBeforeTable,
    commentBeforeFieldText,
    setCommentBeforeField,
    openAddFieldModal,
    confirmAddField,
    directAddField,
    deleteField,
    currentSchemaName,
    currentSchemaNameOfField,
    updateFieldProp,
    updateFieldProps,
    updateFieldName,
    moveFieldUp,
    moveFieldDown,
    addIndex,
    deleteIndex,
    syncFieldNameInIndexes,
    indexColumnsText,
    setIndexColumns,
    getTableMysqlEngine,
    getTableMysqlCharset,
    getTableMysqlCollation,
    setTableMysqlEngine,
    setTableMysqlCharset,
    setTableMysqlCollation,
    setTablePreSql,
    setTablePostSql,
    setSchemaPreSql,
    setSchemaPostSql,
    getFieldOverrideValue,
    setFieldOverrideValue,
    getIndexOverrideValue,
    setIndexOverrideValue,
    buildTableExportData,
    buildSchemaExportData,
  }
}
