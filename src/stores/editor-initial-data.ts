import { computed, type ComputedRef } from 'vue'
import type { Schema, Table, Field, InitialData } from '@/types/schema'
import { newInitialDataId } from '@/core/ids'
import { affectedInitialData, affectedSql, type Command } from '@/core/history/command'
import type { SqlDialect } from '@/utils/sql-generator/shared'

export interface InitialDataDeps {
  initialDataMap: Map<string, InitialData>
  initialDataDeletedKeys: Set<string>
  schemas: Schema[]
  currentSchema: ComputedRef<Schema | null | undefined>
  currentTable: ComputedRef<Table | null | undefined>
  executeCommand: (cmd: Command) => void
  t: (key: string, options?: any) => string
}

export function createInitialDataActions(deps: InitialDataDeps) {
  const {
    initialDataMap,
    initialDataDeletedKeys,
    schemas,
    currentSchema,
    currentTable,
    executeCommand,
    t,
  } = deps

  // ===== Initial Data Helpers =====
  function initialDataKey(schemaName: string, tableName: string): string {
    return `${schemaName}/${tableName}`
  }

  /** 反查某个 InitialData 对象所属的 schema/table（用于命令 affectedFiles） */
  function findInitialDataOwner(data: InitialData): { schema: string; table: string } | null {
    for (const [key, value] of initialDataMap.entries()) {
      if (value === data) {
        const sep = key.indexOf('/')
        return { schema: key.substring(0, sep), table: key.substring(sep + 1) }
      }
    }
    return null
  }

  const currentInitialDataKey = computed(() => {
    if (!currentSchema.value || !currentTable.value) return null
    return initialDataKey(currentSchema.value.schema, currentTable.value.name)
  })

  const currentInitialData = computed(() => {
    if (!currentInitialDataKey.value) return undefined
    return initialDataMap.get(currentInitialDataKey.value)
  })

  // ===== Initial Data CRUD =====

  /** JSON 模式：直接设置完整 InitialData 对象 */
  function setInitialDataObject(schemaName: string, tableName: string, data: InitialData) {
    const key = initialDataKey(schemaName, tableName)
    const oldData = initialDataMap.get(key)
    const oldDeleted = initialDataDeletedKeys.has(key)
    const willDelete = (data.rows?.length ?? 0) === 0 && !data.pre_sql && !data.post_sql
    executeCommand({
      label: t('history.editInitialDataObject'),
      apply() {
        if (willDelete) {
          initialDataMap.delete(key)
          initialDataDeletedKeys.add(key)
        } else {
          // 新建初始数据时，为每一行分配 id（无论是否已创建版本）
          if (data.rows) {
            for (const row of data.rows) {
              if (!row.initial_data_id) row.initial_data_id = newInitialDataId()
            }
          }
          initialDataMap.set(key, data)
          initialDataDeletedKeys.delete(key)
        }
      },
      revert() {
        if (oldData) {
          initialDataMap.set(key, oldData)
        } else {
          initialDataMap.delete(key)
        }
        if (oldDeleted) {
          initialDataDeletedKeys.add(key)
        } else {
          initialDataDeletedKeys.delete(key)
        }
      },
      affectedFiles() {
        return [affectedInitialData(schemaName, tableName), affectedSql()]
      },
    })
  }

  function deleteInitialData(schemaName: string, tableName: string) {
    const key = initialDataKey(schemaName, tableName)
    const oldData = initialDataMap.get(key)
    const oldDeleted = initialDataDeletedKeys.has(key)
    executeCommand({
      label: t('history.deleteInitialData'),
      apply() {
        initialDataMap.delete(key)
        initialDataDeletedKeys.add(key)
      },
      revert() {
        if (oldData) {
          initialDataMap.set(key, oldData)
        }
        if (oldDeleted) {
          initialDataDeletedKeys.add(key)
        } else {
          initialDataDeletedKeys.delete(key)
        }
      },
      affectedFiles() {
        return [affectedInitialData(schemaName, tableName), affectedSql()]
      },
    })
  }

  /** 切换某行是否跳过（不生成 INSERT），支持 undo/redo */
  function setInitialDataRowSkip(
    schemaName: string,
    tableName: string,
    row: { is_skip?: boolean },
    checked: boolean,
  ) {
    const oldSkip = row.is_skip
    executeCommand({
      label: t('history.toggleSkipRow'),
      apply() {
        if (checked) {
          row.is_skip = true
        } else {
          delete row.is_skip
        }
      },
      revert() {
        if (oldSkip === undefined) {
          delete row.is_skip
        } else {
          row.is_skip = oldSkip
        }
      },
      affectedFiles() {
        return [affectedInitialData(schemaName, tableName), affectedSql()]
      },
    })
  }

  /** 设置某行某字段的注释，支持 undo/redo */
  function setInitialDataFieldComment(
    schemaName: string,
    tableName: string,
    row: { field_comments?: Record<string, string> },
    fieldName: string,
    val: string,
  ) {
    const trimmed = val.trim()
    const oldVal = row.field_comments?.[fieldName]
    const oldObj = row.field_comments ? { ...row.field_comments } : undefined
    executeCommand({
      label: t('history.editInitialDataComment', { name: fieldName }),
      apply() {
        if (!trimmed) {
          if (row.field_comments) {
            delete row.field_comments[fieldName]
            if (Object.keys(row.field_comments).length === 0) {
              delete row.field_comments
            }
          }
        } else {
          if (!row.field_comments) row.field_comments = {}
          row.field_comments[fieldName] = trimmed
        }
      },
      revert() {
        if (oldVal === undefined) {
          if (row.field_comments && Object.keys(oldObj ?? {}).length === 0) {
            delete row.field_comments
          } else if (row.field_comments) {
            delete row.field_comments[fieldName]
          }
        } else if (oldObj) {
          row.field_comments = { ...oldObj }
        }
      },
      affectedFiles() {
        return [affectedInitialData(schemaName, tableName), affectedSql()]
      },
    })
  }

  /** 设置某行某字段的数据值，支持 undo/redo（连续编辑合并） */
  function setInitialDataCell(
    schemaName: string,
    tableName: string,
    row: { data: Record<string, any> },
    fieldName: string,
    val: string,
  ) {
    const oldVal = row.data[fieldName]
    if (oldVal === val) return
    executeCommand({
      label: t('history.editInitialDataCell', { name: fieldName }),
      apply() {
        row.data[fieldName] = val
      },
      revert() {
        row.data[fieldName] = oldVal
      },
      affectedFiles() {
        return [affectedInitialData(schemaName, tableName), affectedSql()]
      },
    })
  }

  /** 设置整行注释，支持 undo/redo */
  function setInitialDataRowComment(
    schemaName: string,
    tableName: string,
    row: { row_comment?: string },
    val: string,
  ) {
    const trimmed = val.trim()
    const oldVal = row.row_comment
    executeCommand({
      label: t('history.editInitialDataRowComment'),
      apply() {
        if (trimmed) {
          row.row_comment = trimmed
        } else {
          delete row.row_comment
        }
      },
      revert() {
        if (oldVal === undefined) {
          delete row.row_comment
        } else {
          row.row_comment = oldVal
        }
      },
      affectedFiles() {
        return [affectedInitialData(schemaName, tableName), affectedSql()]
      },
    })
  }

  // ===== Initial Data Pre/Post SQL =====

  function setInitialDataPreSql(initialData: InitialData, dialect: SqlDialect, val: string) {
    const trimmed = val.trim()
    if (!trimmed && !initialData.pre_sql) return
    const oldPreSql = initialData.pre_sql ? { ...initialData.pre_sql } : undefined
    const owner = findInitialDataOwner(initialData)
    executeCommand({
      label: t('history.editInitialDataPreSql', { dialect }),
      coalesceKey: `initial-pre-sql:${dialect}`,
      apply() {
        if (!initialData.pre_sql) initialData.pre_sql = {}
        if (trimmed) {
          initialData.pre_sql[dialect] = trimmed
        } else {
          delete initialData.pre_sql[dialect]
        }
        if (initialData.pre_sql && !initialData.pre_sql.mysql && !initialData.pre_sql.postgresql) {
          delete initialData.pre_sql
        }
      },
      revert() {
        if (oldPreSql) {
          initialData.pre_sql = { ...oldPreSql }
        } else {
          delete initialData.pre_sql
        }
      },
      affectedFiles() {
        return owner
          ? [affectedInitialData(owner.schema, owner.table), affectedSql()]
          : [affectedSql()]
      },
    })
  }

  function setInitialDataPostSql(initialData: InitialData, dialect: SqlDialect, val: string) {
    const trimmed = val.trim()
    if (!trimmed && !initialData.post_sql) return
    const oldPostSql = initialData.post_sql ? { ...initialData.post_sql } : undefined
    const owner = findInitialDataOwner(initialData)
    executeCommand({
      label: t('history.editInitialDataPostSql', { dialect }),
      coalesceKey: `initial-post-sql:${dialect}`,
      apply() {
        if (!initialData.post_sql) initialData.post_sql = {}
        if (trimmed) {
          initialData.post_sql[dialect] = trimmed
        } else {
          delete initialData.post_sql[dialect]
        }
        if (initialData.post_sql && !initialData.post_sql.mysql && !initialData.post_sql.postgresql) {
          delete initialData.post_sql
        }
      },
      revert() {
        if (oldPostSql) {
          initialData.post_sql = { ...oldPostSql }
        } else {
          delete initialData.post_sql
        }
      },
      affectedFiles() {
        return owner
          ? [affectedInitialData(owner.schema, owner.table), affectedSql()]
          : [affectedSql()]
      },
    })
  }

  return {
    initialDataKey,
    findInitialDataOwner,
    currentInitialDataKey,
    currentInitialData,
    setInitialDataObject,
    deleteInitialData,
    setInitialDataRowSkip,
    setInitialDataFieldComment,
    setInitialDataCell,
    setInitialDataRowComment,
    setInitialDataPreSql,
    setInitialDataPostSql,
  }
}
