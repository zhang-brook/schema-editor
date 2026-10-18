import { reactive } from 'vue'

/** Resizable column: key is used only for persistence and lookup, min is the drag lower bound, and defaultWidth is the initial width */
export interface ResizableColumn {
  key: string
  min: number
  defaultWidth: number
}

function loadWidths(storageKey: string, columns: ResizableColumn[]): Record<string, number> {
  const widths: Record<string, number> = {}
  for (const col of columns) widths[col.key] = col.defaultWidth
  if (typeof localStorage === 'undefined') return widths
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return widths
    const parsed = JSON.parse(raw) as Record<string, unknown>
    for (const col of columns) {
      const value = parsed[col.key]
      if (typeof value === 'number' && Number.isFinite(value)) {
        widths[col.key] = Math.max(col.min, Math.round(value))
      }
    }
  } catch {
    // Fall back to default widths when stored content is corrupt
  }
  return widths
}

/**
 * Header column width dragging: each column width is persisted per column, and unadjusted columns use their defaults.
 * The table needs `table-layout: fixed` for width changes to take effect immediately.
 */
export function useColumnResize(storageKey: string, columns: ResizableColumn[]) {
  const widths = reactive<Record<string, number>>(loadWidths(storageKey, columns))
  const columnMap = new Map(columns.map(col => [col.key, col]))

  function widthStyle(key: string) {
    const width = widths[key]
    return width === undefined ? undefined : { width: `${width}px` }
  }

  function persist() {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(storageKey, JSON.stringify(widths))
  }

  function onResizeStart(e: PointerEvent, key: string) {
    const col = columnMap.get(key)
    const handle = e.currentTarget as HTMLElement | null
    const th = handle?.closest('th') as HTMLElement | null
    if (!col || !handle || !th) return
    e.preventDefault()
    const startX = e.clientX
    const startWidth = th.getBoundingClientRect().width
    try {
      // Pointer capture keeps the cursor as col-resize during the whole drag; some environments have no valid pointer id, and failure does not affect dragging
      handle.setPointerCapture(e.pointerId)
    } catch {
      // Ignore
    }
    document.body.classList.add('col-resizing')

    function onMove(ev: PointerEvent) {
      widths[key] = Math.max(col!.min, Math.round(startWidth + ev.clientX - startX))
    }
    function onEnd() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      document.body.classList.remove('col-resizing')
      persist()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }

  return { widthStyle, onResizeStart }
}
