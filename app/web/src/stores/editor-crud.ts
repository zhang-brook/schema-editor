import type { Ref, ComputedRef } from 'vue'
import type { CommonConfig, Schema, InitialData } from 'schema-editor-core/types/schema'
import type { SettingsTab } from '@/types/settings'
import type { Command } from 'schema-editor-core/core/history/command'
import { createActionContext } from './editor-action-utils'
import { createSchemaActions } from './editor-schema-actions'
import { createTableActions } from './editor-table-actions'
import { createFieldActions } from './editor-field-actions'
import { createIndexActions } from './editor-index-actions'

export interface CrudDeps {
  schemas: Schema[]
  commonConfig: Ref<CommonConfig | null>
  selectedSchemaIdx: Ref<number>
  selectedTableIdx: Ref<number>
  expandedFields: Set<string>
  expandedIndexes: Set<string>
  settingsTab: Ref<SettingsTab>
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
  t: (key: string, options?: Record<string, unknown>) => string
}

export function createCrudActions(deps: CrudDeps) {
  const context = createActionContext(deps)
  function toggle(set: Set<string>, key: string) {
    if (set.has(key)) set.delete(key)
    else set.add(key)
  }
  return {
    ...createSchemaActions(deps),
    ...createTableActions(deps, context), // includes updateTable
    ...createFieldActions(deps, context), // includes moveField
    ...createIndexActions(deps, context), // includes updateIndex
    currentSchemaName: context.currentSchemaName,
    selectSettingsTab: (tab: SettingsTab) => { deps.settingsTab.value = tab },
    toggleFieldExpand: (key: string) => toggle(deps.expandedFields, key),
    toggleIndexExpand: (key: string) => toggle(deps.expandedIndexes, key),
  }
}
