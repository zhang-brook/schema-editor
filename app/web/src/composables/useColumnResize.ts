import { reactive } from 'vue'

/** 可拖拽列：key 仅用于持久化与查找，min 为拖拽下限，defaultWidth 为初始宽度 */
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
    // 存储内容损坏时回退默认宽度
  }
  return widths
}

/**
 * 表头列宽拖拽：每列宽度按列持久化，未调整过的列使用默认值。
 * 表格需要 `table-layout: fixed` 才能让宽度收放都即时生效。
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
      // 指针捕获让光标在整段拖拽中保持 col-resize；部分环境无有效指针 id，失败不影响拖拽
      handle.setPointerCapture(e.pointerId)
    } catch {
      // 忽略
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
