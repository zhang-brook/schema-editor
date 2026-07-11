import type { Ref } from 'vue'
import type { CommonConfig, Schema, Field, UnifiedTypeDefinition, TypeCaseMode, TableDdlMode } from '@/types/schema'
import { affectedCommon, affectedSql, type Command } from '@/core/history/command'
import type { SqlDialect } from '@/utils/sql-generator/shared'

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
        } else {
          if (!commonConfig.value!.default_config.postgresql) {
            commonConfig.value!.default_config.postgresql = { quote_identifiers: true }
          }
          commonConfig.value!.default_config.postgresql.pre_sql = trimmed || undefined
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

  function deleteCommonUsedField(name: string) {
    if (!commonConfig.value) return
    if (!commonConfig.value.common_used_fields[name]) return
    // 检查是否有表正在引用此 common field
    const referencingTables: string[] = []
    for (const schema of schemas) {
      for (const table of schema.tables) {
        if (table.fields.some(f => f.use_common_used_fields && f.field_name === name)) {
          referencingTables.push(`${schema.schema}.${table.name}`)
        }
      }
    }
    if (referencingTables.length > 0) {
      if (!confirm(
        t('confirm.deleteCommonField', { name, refs: referencingTables.join('\n') })
      )) return
    }
    const deletedField = { ...commonConfig.value.common_used_fields[name] }
    const hadOrder = commonConfig.value.common_used_field_order !== undefined
    const oldOrder = hadOrder ? [...commonConfig.value.common_used_field_order!] : undefined
    executeCommand({
      label: t('history.deleteCommonField'),
      apply() {
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
        commonConfig.value!.common_used_fields[name] = { ...deletedField }
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
    showToast(t('toast.commonFieldDeleted'))
  }

  function updateCommonUsedFieldName(oldName: string, newName: string) {
    const trimmed = newName.trim()
    if (!trimmed || oldName === trimmed) return
    // 捕获命令执行前所有引用此 common field 的表的字段快照，用于完整回滚
    const affectedFields: { field: Field; oldName: string }[] = []
    for (const schema of schemas) {
      for (const table of schema.tables) {
        for (const field of table.fields) {
          if (field.use_common_used_fields && field.field_name === oldName) {
            affectedFields.push({ field, oldName: field.field_name })
          }
        }
      }
    }
    const hadOrder = commonConfig.value?.common_used_field_order !== undefined
    const oldOrder = hadOrder ? [...commonConfig.value!.common_used_field_order!] : undefined
    executeCommand({
      label: t('history.renameCommonField'),
      apply() {
        for (const { field } of affectedFields) {
          field.field_name = trimmed
        }
        if (commonConfig.value?.common_used_field_order) {
          const idx = commonConfig.value.common_used_field_order.indexOf(oldName)
          if (idx !== -1) commonConfig.value.common_used_field_order[idx] = trimmed
        }
      },
      revert() {
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

  return {
    setGlobalPreSql,
    setGlobalPostSql,
    getCommonMysqlEngine,
    getCommonMysqlCharset,
    getCommonMysqlCollation,
    setCommonMysqlEngine,
    setCommonMysqlCharset,
    setCommonMysqlCollation,
    getCommonPostgresqlQuoteIdentifiers,
    setCommonPostgresqlQuoteIdentifiers,
    getTableDdlMode,
    setTableDdlMode,
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
