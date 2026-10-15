import { describe, expect, it } from 'vitest'
import editorSource from './editor.ts?raw'
import toolbarSource from '@/components/EditorToolbar.vue?raw'
import appSource from '@/App.vue?raw'

// 保存链路的接线守卫：改动落盘必须经工作区会话按需写入，
// 不允许回退到「深度 watch 项目对象 → 全量重写所有 json」的旧机制。
describe('editor store save wiring', () => {
  it('routes command persistence through the workspace session only', () => {
    expect(editorSource).toContain('history.setPersistHook((files) => { markChanged(files) })')
    expect(editorSource).toMatch(/function markChanged\(files: AffectedFile\[\]\) \{\s*session\?\.changed\(files\)/)
    expect(editorSource).toContain('session = createWorkspaceSession({')
    expect(editorSource).toMatch(/await session\.saveAll\(\)/)
  })

  it('keeps the deep-watch full save removed', () => {
    expect(editorSource).not.toMatch(/syncAllToDisk|setupAutoSync|persistAffectedFiles|debouncedSync/)
    expect(editorSource).not.toContain('deep: true')
    expect(editorSource).not.toMatch(/watch\(\s*(commonConfig|schemas|initialDataMap)/)
  })

  it('guards unsaved edits before leaving the project', () => {
    expect(editorSource).toContain('const choice = await chooseDialog({')
    expect(editorSource).toContain("message: t('confirm.unsavedChanges')")
    for (const caller of ['confirmUpgradeStructure', 'closeProject', 'requestCloseProject', 'reloadFromDisk']) {
      expect(editorSource).toContain(caller)
    }
    expect(editorSource).toMatch(/async function reloadFromDisk\(\) \{[\s\S]*?confirmLeaveUnsaved\(\)/)
    expect(editorSource).toMatch(/async function requestCloseProject\(silent = false\): Promise<boolean> \{[\s\S]*?confirmLeaveUnsaved\(\)/)
  })
})

describe('toolbar save controls', () => {
  it('exposes a manual save action and the auto-save switch', () => {
    expect(toolbarSource).toContain('store.saveProjectWithFeedback()')
    expect(toolbarSource).toContain('store.setAutoSave(($event.target as HTMLInputElement).checked)')
    expect(toolbarSource).toMatch(/const saveBadge = computed/)
    expect(toolbarSource).toContain('store.hasUnsavedChanges')
  })

  it('binds Ctrl/Cmd+S and warns the browser before unloading dirty state', () => {
    expect(toolbarSource).toContain("(e.key === 's' || e.key === 'S')")
    expect(toolbarSource).toContain("window.addEventListener('beforeunload', onBeforeUnload)")
  })

  it('marks the tab title and hands the three-way choice to the store', () => {
    expect(toolbarSource).toContain('document.title = store.hasUnsavedChanges')
    expect(appSource).toContain("resolveConfirm('secondary')")
    expect(appSource).toContain(':secondary-text="confirmState.secondaryText"')
  })
})
