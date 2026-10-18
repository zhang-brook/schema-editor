import { describe, expect, it } from 'vitest'
import editorSource from './editor.ts?raw'
import toolbarSource from '@/components/EditorToolbar.vue?raw'
import appSource from '@/App.vue?raw'

// Wiring guard for the save path: persisted changes must go through the workspace
// session on demand; the old "deep watch project object -> rewrite all json" mechanism is not allowed.
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
  it('keeps the save action available even when nothing changed', () => {
    // Derived files on disk may be deleted externally: saving must work even with no changes
    expect(editorSource).toMatch(/async function saveProjectWithFeedback\(\) \{\s*if \(!session\) return\s*await saveProject\(\)/)
    expect(toolbarSource).not.toContain(':disabled="!store.hasUnsavedChanges')
    expect(toolbarSource).toContain(':disabled="store.saveState.saving"')
    expect(toolbarSource).not.toContain('store.hasUnsavedChanges && menuAction')
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

  it('controls project files and derived SQL with a dependency between the two switches', () => {
    expect(editorSource).toContain('const autoSyncOutputsEnabled = ref(')
    expect(editorSource).toContain('function setAutoSyncOutputs(enabled: boolean)')
    expect(editorSource).toContain('if (!enabled) writeAutoSyncOutputsPref(false)')
    expect(editorSource).toContain('if (enabled) writeAutoSavePref(true)')
    expect(editorSource).toContain('session?.coordinator.setAutoSave({ docs: enabled })')
    expect(editorSource).toContain('session?.coordinator.setAutoSave({ outputs: enabled })')
    expect(editorSource).toContain('autoSave: { docs: autoSaveEnabled.value, outputs: autoSyncOutputsEnabled.value }')
    expect(toolbarSource).toContain('store.setAutoSyncOutputs(($event.target as HTMLInputElement).checked)')
    expect(toolbarSource).toContain("$t('toolbar.autoSyncSql')")
  })

  it('marks the tab title and hands the three-way choice to the store', () => {
    expect(toolbarSource).toContain('document.title = store.hasUnsavedChanges')
    expect(appSource).toContain("resolveConfirm('secondary')")
    expect(appSource).toContain(':secondary-text="confirmState.secondaryText"')
  })
})
