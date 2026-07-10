/**
 * 命令模式 + 结构化补丁（undo/redo 底层）。
 *
 * 每次用户改动生成一个原子命令（含 apply/revert/affectedFiles），
 * undo/redo 只应用/回滚该命令，并只写受影响的 json 文件。
 *
 * 设计要点：
 * - `apply()` 操作内存态（editor store 的 reactive 数据），不直接碰 FS。
 * - `revert()` 恢复操作前的内存态快照。
 * - `affectedFiles()` 返回本命令影响的最小文件集合，用于按需写盘。
 * - `coalesceKey` + 时间窗口：连续同类高频操作（如输入框打字）合并为单条
 *   undo 记录，避免历史膨胀；revert 始终为操作前快照、apply 始终为最终态，
 *   不会产生撤销状态不一致。
 */

import type { InitialData } from '@/types/schema'

/** 命令影响的文件种类 */
export type AffectedFileKind = 'table' | 'initial-data' | 'common' | 'database' | 'sql' | 'schema'

/** 单个受影响文件描述 */
export interface AffectedFile {
  kind: AffectedFileKind
  schema?: string
  table?: string
  /** 重命名场景下的旧名（如 schema/table 改名），用于清理旧磁盘目录 */
  oldSchema?: string
  oldTable?: string
}

export interface Command {
  label: string
  /** 合并键：相同且时间窗口内的命令合并为单条 undo 记录 */
  coalesceKey?: string
  /** 应用：修改内存态 */
  apply(): void
  /** 回滚：恢复原内存态 */
  revert(): void
  /** 本命令影响的最小文件集合（用于按需写盘） */
  affectedFiles(): AffectedFile[]
}

/** 按需写盘回调：命令执行后由 store 实现，只写传入的文件集合 */
export type PersistHook = (files: AffectedFile[]) => void

const COALESCE_WINDOW_MS = 800

export class CommandManager {
  private undoStack: Command[] = []
  private redoStack: Command[] = []
  private persistHook: PersistHook | null = null
  private lastExecuteTime = 0

  /** 注册按需写盘回调（由 editor store 注入） */
  setPersistHook(hook: PersistHook) {
    this.persistHook = hook
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  get undoLabel(): string | null {
    return this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1]!.label : null
  }

  get redoLabel(): string | null {
    return this.redoStack.length > 0 ? this.redoStack[this.redoStack.length - 1]!.label : null
  }

  /** 清空所有历史（如关闭项目、重新加载时） */
  clear() {
    this.undoStack = []
    this.redoStack = []
  }

  /**
   * 执行一个命令：
   * 1. 应用内存态（apply）
   * 2. 若与栈顶 coalesceKey 相同且在时间窗口内，则合并（不压新栈，终态已随 apply 刷新）
   * 3. 否则压入 undo 栈、清空 redo 栈
   * 4. 触发按需写盘
   */
  execute(cmd: Command) {
    cmd.apply()

    const now = Date.now()
    const top = this.undoStack[this.undoStack.length - 1]
    const canCoalesce =
      top &&
      top.coalesceKey !== undefined &&
      cmd.coalesceKey !== undefined &&
      top.coalesceKey === cmd.coalesceKey &&
      now - this.lastExecuteTime <= COALESCE_WINDOW_MS

    if (!canCoalesce) {
      this.undoStack.push(cmd)
      this.redoStack = []
    }
    this.lastExecuteTime = now

    this.persistHook?.(cmd.affectedFiles())
  }

  /** 撤销上一步 */
  undo() {
    const cmd = this.undoStack.pop()
    if (!cmd) return
    cmd.revert()
    this.redoStack.push(cmd)
    this.persistHook?.(cmd.affectedFiles())
  }

  /** 重做下一步 */
  redo() {
    const cmd = this.redoStack.pop()
    if (!cmd) return
    cmd.apply()
    this.undoStack.push(cmd)
    this.persistHook?.(cmd.affectedFiles())
  }
}

/** 构造受影响文件集合的辅助函数 */
export function affectedTable(schema: string, table: string): AffectedFile {
  return { kind: 'table', schema, table }
}

export function affectedInitialData(schema: string, table: string): AffectedFile {
  return { kind: 'initial-data', schema, table }
}

export function affectedSchema(schema: string): AffectedFile {
  return { kind: 'schema', schema }
}

export function affectedDatabase(): AffectedFile {
  return { kind: 'database' }
}

export function affectedCommon(): AffectedFile {
  return { kind: 'common' }
}

export function affectedSql(): AffectedFile {
  return { kind: 'sql' }
}

/** 合并并去重受影响文件集合 */
export function mergeAffectedFiles(files: AffectedFile[]): AffectedFile[] {
  const seen = new Set<string>()
  const result: AffectedFile[] = []
  for (const f of files) {
    const key = f.kind === 'table' || f.kind === 'initial-data' || f.kind === 'schema'
      ? `${f.kind}:${f.schema}:${f.table ?? ''}`
      : f.kind
    if (seen.has(key)) continue
    seen.add(key)
    result.push(f)
  }
  return result
}

/** 便捷构造：从内存态 initialDataMap 读取当前 initial-data（供命令闭包捕获） */
export type InitialDataLookup = (schema: string, table: string) => InitialData | undefined
