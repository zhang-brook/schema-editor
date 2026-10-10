import type { Ref } from 'vue'
import type { CommonConfig, Schema, Table, Field, UnifiedTypeDefinition, TypeCaseMode, TableDdlMode, LogicalDeleteConfig } from '@/types/schema'
import { affectedCommon, affectedTable, affectedSql, type Command } from '@/core/history/command'
import type { SqlDialect } from '@/utils/sql-generator/shared'
import { moveFieldCommentBefore, removeFieldCommentBefore } from '@/utils/table-comment-utils'
import { createIndexFieldRemoval } from '@/utils/index-column-utils'
import { confirmDialog } from '@/composables/useConfirm'

export interface CommonConfigDeps {
  commonConfig: Ref<CommonConfig | null>
  schemas: Schema[]
  executeCommand: (cmd: Command) => void
  showToast: (msg: string) => void
  t: (key: string, options?: any) => string
}

export function createCommonConfigActions(deps: CommonConfigDeps) {
  const {
    commonConfig,
    schemas,
    executeCommand,
    showToast,
    t,
  } = deps

  // ===== Global Pre/Post SQL =====

  function setGlobalPreSql(dialect: SqlDialect, val: string) {
    if (!commonConfig.value) return
    const trimmed = val.trim()
    const oldDefaultConfig = JSON.parse(JSON.stringify(commonConfig.value.default_config))
    executeCommand({
      label: t('history.editGlobalPreSql', { dialect }),
      coalesceKey: `global-pre-sql:${dialect}`,
      apply() {
        if (dialect === 'mysql') {
          commonConfig.value!.default_config.mysql.pre_sql = trimmed || undefined
        } else if (dialect === 'postgresql') {
          if (!commonConfig.value!.default_config.postgresql) {
            commonConfig.value!.default_config.postgresql = { quote_identifiers: true }
          }
          commonConfig.value!.default_config.postgresql.pre_sql = trimmed || undefined
        } else if (dialect === 'sqlite') {
          if (!commonConfig.value!.default_config.sqlite) {
            commonConfig.value!.default_config.sqlite = { quote_identifiers: true }
          }
          commonConfig.value!.default_config.sqlite.pre_sql = trimmed || undefined
        }
      },
      revert() {
        commonConfig.value!.default_config = JSON.parse(JSON.stringify(oldDefaultConfig))
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
  }

  function setGlobalPostSql(dialect: SqlDialect, val: string) {
    if (!commonConfig.value) return
    const trimmed = val.trim()
    const oldDefaultConfig = JSON.parse(JSON.stringify(commonConfig.value.default_config))
    executeCommand({
      label: t('history.editGlobalPostSql', { dialect }),
      coalesceKey: `global-post-sql:${dialect}`,
      apply() {
        if (dialect === 'mysql') {
          commonConfig.value!.default_config.mysql.post_sql = trimmed || undefined
        } else if (dialect === 'sqlite') {
          if (!commonConfig.value!.default_config.sqlite) {
            commonConfig.value!.default_config.sqlite = { quote_identifiers: true }
          }
          commonConfig.value!.default_config.sqlite.post_sql = trimmed || undefined
        } else {
          if (!commonConfig.value!.default_config.postgresql) {
            commonConfig.value!.default_config.postgresql = { quote_identifiers: true }
          }
          commonConfig.value!.default_config.postgresql.post_sql = trimmed || undefined
        }
      },
      revert() {
        commonConfig.value!.default_config = JSON.parse(JSON.stringify(oldDefaultConfig))
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
  }

  // ===== 项目信息（common.json 的 project_name / project_description） =====

  function setProjectName(val: string) {
    if (!commonConfig.value) return
    const old = commonConfig.value.project_name
    executeCommand({
      label: t('history.editProjectName'),
      coalesceKey: 'project-name',
      apply() {
        // 清空视为未设置，避免在 common.json 中留下空字符串
        commonConfig.value!.project_name = val.trim() ? val : undefined
      },
      revert() {
        commonConfig.value!.project_name = old
      },
      affectedFiles() {
        return [affectedCommon()]
      },
    })
  }

  function setProjectDescription(val: string) {
    if (!commonConfig.value) return
    const old = commonConfig.value.project_description
    executeCommand({
      label: t('history.editProjectDescription'),
      coalesceKey: 'project-description',
      apply() {
        commonConfig.value!.project_description = val.trim() ? val : undefined
      },
      revert() {
        commonConfig.value!.project_description = old
      },
      affectedFiles() {
        return [affectedCommon()]
      },
    })
  }

  // ===== Common Config Editing =====
  function getCommonMysqlEngine() {
    return commonConfig.value?.default_config?.mysql?.table?.mysql_engine || ''
  }
  function getCommonMysqlCharset() {
    return commonConfig.value?.default_config?.mysql?.table?.mysql_charset || ''
  }
  function getCommonMysqlCollation() {
    return commonConfig.value?.default_config?.mysql?.table?.mysql_collation || ''
  }
  function setCommonMysqlEngine(val: string) {
    if (!commonConfig.value) return
    const old = commonConfig.value.default_config.mysql.table.mysql_engine
    executeCommand({
      label: t('history.editMysqlEngine'),
      coalesceKey: 'common-mysql-engine',
      apply() {
        commonConfig.value!.default_config.mysql.table.mysql_engine = val
      },
      revert() {
        commonConfig.value!.default_config.mysql.table.mysql_engine = old
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
  }
  function setCommonMysqlCharset(val: string) {
    if (!commonConfig.value) return
    const old = commonConfig.value.default_config.mysql.table.mysql_charset
    executeCommand({
      label: t('history.editMysqlCharset'),
      coalesceKey: 'common-mysql-charset',
      apply() {
        commonConfig.value!.default_config.mysql.table.mysql_charset = val
      },
      revert() {
        commonConfig.value!.default_config.mysql.table.mysql_charset = old
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
  }
  function setCommonMysqlCollation(val: string) {
    if (!commonConfig.value) return
    const old = commonConfig.value.default_config.mysql.table.mysql_collation
    executeCommand({
      label: t('history.editMysqlCollation'),
      coalesceKey: 'common-mysql-collation',
      apply() {
        commonConfig.value!.default_config.mysql.table.mysql_collation = val
      },
      revert() {
        commonConfig.value!.default_config.mysql.table.mysql_collation = old
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
  }

  function getCommonPostgresqlQuoteIdentifiers(): boolean {
    return commonConfig.value?.default_config?.postgresql?.quote_identifiers ?? true
  }
  function setCommonPostgresqlQuoteIdentifiers(val: boolean) {
    if (!commonConfig.value) return
    const old = getCommonPostgresqlQuoteIdentifiers()
    executeCommand({
      label: t('history.editPgQuoteIdentifiers'),
      apply() {
        if (!commonConfig.value!.default_config.postgresql) {
          commonConfig.value!.default_config.postgresql = { quote_identifiers: true }
        }
        commonConfig.value!.default_config.postgresql.quote_identifiers = val
      },
      revert() {
        if (!commonConfig.value!.default_config.postgresql) {
          commonConfig.value!.default_config.postgresql = { quote_identifiers: true }
        }
        commonConfig.value!.default_config.postgresql.quote_identifiers = old
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
  }

  function getCommonSqliteQuoteIdentifiers(): boolean {
    return commonConfig.value?.default_config?.sqlite?.quote_identifiers ?? true
  }
  function setCommonSqliteQuoteIdentifiers(val: boolean) {
    if (!commonConfig.value) return
    const old = getCommonSqliteQuoteIdentifiers()
    executeCommand({
      label: t('history.editSqliteQuoteIdentifiers'),
      apply() {
        if (!commonConfig.value!.default_config.sqlite) {
          commonConfig.value!.default_config.sqlite = { quote_identifiers: true }
        }
        commonConfig.value!.default_config.sqlite.quote_identifiers = val
      },
      revert() {
        if (!commonConfig.value!.default_config.sqlite) {
          commonConfig.value!.default_config.sqlite = { quote_identifiers: true }
        }
        commonConfig.value!.default_config.sqlite.quote_identifiers = old
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
  }

  function getTableDdlMode(): TableDdlMode {
    return commonConfig.value?.default_config?.table_ddl_mode ?? 'drop_and_create'
  }
  function setTableDdlMode(val: TableDdlMode) {
    if (!commonConfig.value) return
    const old = getTableDdlMode()
    executeCommand({
      label: t('history.editTableDdlMode'),
      apply() {
        commonConfig.value!.default_config.table_ddl_mode = val === 'drop_and_create' ? undefined : val
      },
      revert() {
        commonConfig.value!.default_config.table_ddl_mode = old === 'drop_and_create' ? undefined : old
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
  }

  function getCommonTypeCase(): TypeCaseMode {
    return commonConfig.value?.type_case ?? 'keep'
  }
  function setCommonTypeCase(val: TypeCaseMode) {
    if (!commonConfig.value) return
    const old = getCommonTypeCase()
    executeCommand({
      label: t('history.editTypeCase'),
      apply() {
        commonConfig.value!.type_case = val
      },
      revert() {
        commonConfig.value!.type_case = old
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
  }

  // ===== Common Used Fields CRUD =====
  function addCommonUsedField(name: string) {
    if (!commonConfig.value) return
    if (!name.trim()) { showToast(t('toast.pleaseEnterFieldName')); return }
    const key = name.trim()
    if (commonConfig.value.common_used_fields[key]) {
      showToast(t('toast.commonFieldExists', { name: key }))
      return
    }
    const hadOrder = commonConfig.value.common_used_field_order !== undefined
    const oldOrder = hadOrder ? [...commonConfig.value.common_used_field_order!] : undefined
    executeCommand({
      label: t('history.addCommonField'),
      apply() {
        commonConfig.value!.common_used_fields[key] = {
          field_name: key,
          field_type: 'varchar',
          field_length: 255,
          not_null: false,
          primary_key: false,
          comment: ''
        }
        if (!commonConfig.value!.common_used_field_order) {
          commonConfig.value!.common_used_field_order = []
        }
        commonConfig.value!.common_used_field_order.push(key)
      },
      revert() {
        delete commonConfig.value!.common_used_fields[key]
        if (hadOrder) {
          commonConfig.value!.common_used_field_order = [...oldOrder!]
        } else {
          commonConfig.value!.common_used_field_order = undefined
        }
      },
      affectedFiles() {
        return [affectedCommon()]
      },
    })
    showToast(t('toast.commonFieldAdded'))
  }

  async function deleteCommonUsedField(name: string) {
    if (!commonConfig.value) return
    if (!commonConfig.value.common_used_fields[name]) return
    // 收集所有引用此公共字段的表字段，删除公共字段时同步删除并支持回滚
    interface RefFieldSnapshot {
      schemaName: string
      table: Table
      field: Field
      indexInTable: number
      indexRemoval: ReturnType<typeof createIndexFieldRemoval>
      undoComment: (() => void) | null
    }
    const refSnapshots: RefFieldSnapshot[] = []
    const referencingTables: string[] = []
    const seenTables = new Set<string>()
    for (const schema of schemas) {
      for (const table of schema.tables) {
        const idx = table.fields.findIndex(f => f.use_common_used_fields && f.field_name === name)
        if (idx >= 0) {
          const field = table.fields[idx]!
          refSnapshots.push({
            schemaName: schema.schema,
            table,
            field,
            indexInTable: idx,
            indexRemoval: createIndexFieldRemoval(table.indexes, field.field_name),
            undoComment: null,
          })
          const key = `${schema.schema}.${table.name}`
          if (!seenTables.has(key)) {
            seenTables.add(key)
            referencingTables.push(key)
          }
        }
      }
    }
    if (referencingTables.length > 0) {
      if (!(await confirmDialog({ title: t('confirm.title'), message: t('confirm.deleteCommonField', { name, refs: referencingTables.join('\n') }), confirmText: t('confirm.ok'), cancelText: t('confirm.cancel') }))) return
    }
    const deletedField = { ...commonConfig.value.common_used_fields[name] }
    const hadOrder = commonConfig.value.common_used_field_order !== undefined
    const oldOrder = hadOrder ? [...commonConfig.value.common_used_field_order!] : undefined
    executeCommand({
      label: t('history.deleteCommonField'),
      apply() {
        // 同步删除引用此公共字段的表字段（含索引、字段前注释清理）
        for (const snap of refSnapshots) {
          const i = snap.table.fields.indexOf(snap.field)
          if (i >= 0) snap.table.fields.splice(i, 1)
          snap.indexRemoval.apply()
          snap.undoComment?.()
          snap.undoComment = removeFieldCommentBefore(snap.table, snap.field.field_name)
        }
        // 删除公共字段定义
        delete commonConfig.value!.common_used_fields[name]
        if (commonConfig.value!.common_used_field_order) {
          commonConfig.value!.common_used_field_order =
            commonConfig.value!.common_used_field_order.filter(k => k !== name)
          if (commonConfig.value!.common_used_field_order.length === 0) {
            commonConfig.value!.common_used_field_order = undefined
          }
        }
      },
      revert() {
        // 恢复公共字段定义
        commonConfig.value!.common_used_fields[name] = { ...deletedField }
        if (hadOrder) {
          commonConfig.value!.common_used_field_order = [...oldOrder!]
        } else {
          commonConfig.value!.common_used_field_order = undefined
        }
        // 还原被同步删除的表字段（回到原位置，并恢复索引与字段前注释）
        for (const snap of refSnapshots) {
          const i = Math.min(snap.indexInTable, snap.table.fields.length)
          snap.table.fields.splice(i, 0, snap.field)
          snap.indexRemoval.restore()
          snap.undoComment?.()
          snap.undoComment = null
        }
      },
      affectedFiles() {
        return [affectedCommon(), ...refSnapshots.map(s => affectedTable(s.schemaName, s.table.name)), affectedSql()]
      },
    })
    showToast(t('toast.commonFieldDeleted'))
  }

  function updateCommonUsedFieldName(oldName: string, newName: string) {
    const trimmed = newName.trim()
    if (!trimmed || oldName === trimmed) return
    // 捕获命令执行前所有引用此 common field 的表的字段快照，用于完整回滚
    const affectedFields: { table: Table; field: Field; oldName: string }[] = []
    for (const schema of schemas) {
      for (const table of schema.tables) {
        for (const field of table.fields) {
          if (field.use_common_used_fields && field.field_name === oldName) {
            affectedFields.push({ table, field, oldName: field.field_name })
          }
        }
      }
    }
    const hadOrder = commonConfig.value?.common_used_field_order !== undefined
    const oldOrder = hadOrder ? [...commonConfig.value!.common_used_field_order!] : undefined
    let undoComments: (() => void)[] = []
    executeCommand({
      label: t('history.renameCommonField'),
      apply() {
        for (const undo of undoComments) undo()
        undoComments = []
        for (const { table, field } of affectedFields) {
          field.field_name = trimmed
          const undo = moveFieldCommentBefore(table, oldName, trimmed)
          if (undo) undoComments.push(undo)
        }
        if (commonConfig.value?.common_used_field_order) {
          const idx = commonConfig.value.common_used_field_order.indexOf(oldName)
          if (idx !== -1) commonConfig.value.common_used_field_order[idx] = trimmed
        }
      },
      revert() {
        for (const undo of undoComments) undo()
        undoComments = []
        for (const { field, oldName: prev } of affectedFields) {
          field.field_name = prev
        }
        if (hadOrder) {
          commonConfig.value!.common_used_field_order = [...oldOrder!]
        } else {
          commonConfig.value!.common_used_field_order = undefined
        }
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
  }

  /** 从有序数组重建 record，用于面板编辑后同步 */
  function rebuildCommonUsedFieldsFromArray(fields: Field[]) {
    if (!commonConfig.value) return
    const oldRecord = { ...commonConfig.value.common_used_fields }
    const oldOrder = commonConfig.value.common_used_field_order
      ? [...commonConfig.value.common_used_field_order] : undefined
    executeCommand({
      label: t('history.editCommonFields'),
      coalesceKey: 'rebuild-common-fields',
      apply() {
        const newRecord: Record<string, Field> = {}
        for (const field of fields) {
          newRecord[field.field_name] = field
        }
        commonConfig.value!.common_used_fields = newRecord
        commonConfig.value!.common_used_field_order = fields.map(f => f.field_name)
      },
      revert() {
        commonConfig.value!.common_used_fields = { ...oldRecord }
        commonConfig.value!.common_used_field_order = oldOrder ? [...oldOrder] : undefined
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
  }

  /** 获取有序的公共字段列表（遵循 common_used_field_order，回退到 Object.keys） */
  function getOrderedCommonUsedFields(): Field[] {
    if (!commonConfig.value) return []
    const record = commonConfig.value.common_used_fields
    const order = commonConfig.value.common_used_field_order
    if (order && order.length > 0) {
      return order.filter(k => record[k]).map(k => record[k]!)
    }
    // 回退：Object.keys（老数据无 order 数组时）
    return Object.keys(record).map(k => record[k]!)
  }

  // ===== Unified Types CRUD =====

  function addUnifiedType(name: string) {
    if (!commonConfig.value) return
    if (!name.trim()) { showToast(t('toast.unifiedTypeNameEmpty')); return }
    const key = name.trim()
    if (!commonConfig.value.unified_types) commonConfig.value.unified_types = []
    if (commonConfig.value.unified_types.some(ut => ut.name === key)) {
      showToast(t('toast.unifiedTypeExists', { name: key }))
      return
    }
    executeCommand({
      label: t('history.addUnifiedType'),
      apply() {
        if (!commonConfig.value!.unified_types) commonConfig.value!.unified_types = []
        commonConfig.value!.unified_types.push({
          name: key,
          description: '',
          quote_default: false,
          mysql: { type: 'VARCHAR', length: 255 },
          postgresql: { type: 'VARCHAR', length: 255 },
          sqlite: { type: 'VARCHAR', length: 255 },
        })
      },
      revert() {
        const list = commonConfig.value?.unified_types
        if (list) {
          const idx = list.findIndex(ut => ut.name === key)
          if (idx !== -1) list.splice(idx, 1)
        }
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
    showToast(t('toast.unifiedTypeAdded'))
  }

  function deleteUnifiedType(idx: number) {
    if (!commonConfig.value?.unified_types) return
    const ut = commonConfig.value.unified_types[idx]
    if (!ut) return
    const removed = { ...ut }
    executeCommand({
      label: t('history.deleteUnifiedType'),
      apply() {
        if (commonConfig.value?.unified_types) {
          commonConfig.value.unified_types.splice(idx, 1)
        }
      },
      revert() {
        if (!commonConfig.value!.unified_types) commonConfig.value!.unified_types = []
        commonConfig.value!.unified_types.splice(idx, 0, { ...removed })
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
    showToast(t('toast.unifiedTypeDeleted'))
  }

  /** 重命名统一类型时同步更新所有引用该类型的字段 */
  function renameUnifiedType(oldName: string, newName: string) {
    if (oldName === newName || !oldName || !newName) return
    // 捕获命令执行前所有引用该统一类型的字段快照，用于完整回滚
    const affectedTableFields: { field: Field; oldName: string }[] = []
    for (const schema of schemas) {
      for (const table of schema.tables) {
        for (const field of table.fields) {
          if (field.unified_type === oldName) {
            affectedTableFields.push({ field, oldName: field.unified_type! })
          }
        }
      }
    }
    const affectedCommonFields: { field: Field; oldName: string }[] = []
    if (commonConfig.value?.common_used_fields) {
      for (const key of Object.keys(commonConfig.value.common_used_fields)) {
        const field = commonConfig.value.common_used_fields[key]!
        if (field?.unified_type === oldName) {
          affectedCommonFields.push({ field, oldName: field.unified_type! })
        }
      }
    }
    executeCommand({
      label: t('history.renameUnifiedType'),
      apply() {
        for (const { field } of affectedTableFields) field.unified_type = newName
        for (const { field } of affectedCommonFields) field.unified_type = newName
      },
      revert() {
        for (const { field, oldName: prev } of affectedTableFields) field.unified_type = prev
        for (const { field, oldName: prev } of affectedCommonFields) field.unified_type = prev
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
  }

  function rebuildUnifiedTypesFromArray(types: UnifiedTypeDefinition[]) {
    if (!commonConfig.value) return
    const oldTypes = commonConfig.value.unified_types ? [...commonConfig.value.unified_types] : undefined
    executeCommand({
      label: t('history.editUnifiedTypes'),
      coalesceKey: 'rebuild-unified-types',
      apply() {
        commonConfig.value!.unified_types = types
      },
      revert() {
        commonConfig.value!.unified_types = oldTypes ? [...oldTypes] : undefined
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
  }

  // ===== 逻辑删除配置（项目级） =====
  function getLogicalDelete(): LogicalDeleteConfig {
    return commonConfig.value?.logical_delete ?? {}
  }

  /**
   * 局部更新项目级逻辑删除配置（逐键 patch）。
   * 空串 / undefined 的键会被移除；配置整体为空时移除 logical_delete，避免污染 common.json。
   */
  function setLogicalDelete(patch: Partial<LogicalDeleteConfig>) {
    if (!commonConfig.value) return
    const old = commonConfig.value.logical_delete
      ? { ...commonConfig.value.logical_delete }
      : undefined
    executeCommand({
      label: t('history.editLogicalDelete'),
      coalesceKey: 'logical-delete',
      apply() {
        const next: LogicalDeleteConfig = { ...commonConfig.value!.logical_delete, ...patch }
        for (const k of Object.keys(next) as (keyof LogicalDeleteConfig)[]) {
          if (next[k] === undefined || next[k] === '') delete next[k]
        }
        commonConfig.value!.logical_delete = Object.keys(next).length > 0 ? next : undefined
      },
      revert() {
        commonConfig.value!.logical_delete = old ? { ...old } : undefined
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
  }

  return {
    setGlobalPreSql,
    setGlobalPostSql,
    setProjectName,
    setProjectDescription,
    getCommonMysqlEngine,
    getCommonMysqlCharset,
    getCommonMysqlCollation,
    setCommonMysqlEngine,
    setCommonMysqlCharset,
    setCommonMysqlCollation,
    getCommonPostgresqlQuoteIdentifiers,
    setCommonPostgresqlQuoteIdentifiers,
    getCommonSqliteQuoteIdentifiers,
    setCommonSqliteQuoteIdentifiers,
    getTableDdlMode,
    setTableDdlMode,
    getLogicalDelete,
    setLogicalDelete,
    getCommonTypeCase,
    setCommonTypeCase,
    addCommonUsedField,
    deleteCommonUsedField,
    updateCommonUsedFieldName,
    rebuildCommonUsedFieldsFromArray,
    getOrderedCommonUsedFields,
    addUnifiedType,
    deleteUnifiedType,
    renameUnifiedType,
    rebuildUnifiedTypesFromArray,
  }
}
