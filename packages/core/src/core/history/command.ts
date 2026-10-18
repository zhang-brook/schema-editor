/**
 * Command pattern + structured patches (the foundation of undo/redo).
 *
 * Each user change produces one atomic command (with apply/revert/affectedFiles);
 * undo/redo only applies/reverts that command and writes only the affected json files.
 *
 * Design notes:
 * - `apply()` operates on in-memory state (the editor store's reactive data), never touching the FS.
 * - `revert()` restores the in-memory snapshot taken before the operation.
 * - `affectedFiles()` returns the minimal file set touched by this command, used for on-demand writes.
 * - `coalesceKey` + time window: consecutive high-frequency operations of the same kind
 *   (e.g. typing in an input) merge into a single undo record, avoiding history bloat;
 *   revert stays the pre-operation snapshot and apply the final state, so undo never drifts.
 */

import type { InitialData } from '../../types/schema'

/** Kinds of files affected by a command */
export type AffectedFileKind = 'table' | 'initial-data' | 'common' | 'database' | 'sql' | 'schema'

/** Description of a single affected file */
export interface AffectedFile {
  kind: AffectedFileKind
  schema?: string
  table?: string
  /** Old name in rename scenarios (e.g. schema/table renames), used to clean up the old disk directory */
  oldSchema?: string
  oldTable?: string
}

export interface Command {
  label: string
  /** Coalesce key: only for final-state assignments to the same object; structural operations must not set it */
  coalesceKey?: string
  /** Apply: mutates in-memory state; coalescable commands must restore the final state directly, not accumulate deltas */
  apply(): void
  /** Revert: restores the original in-memory state */
  revert(): void
  /** Minimal file set affected by this command (used for on-demand writes) */
  affectedFiles(): AffectedFile[]
}

/** On-demand persistence hook: implemented by the store after a command runs, writes only the given file set */
export type PersistHook = (files: AffectedFile[]) => void

const COALESCE_WINDOW_MS = 800

interface HistoryEntry extends Command {
  /** File set captured at execution time: identity comparison must not depend on in-memory state that may change later */
  files: AffectedFile[]
}

/** Compares target file identity; old paths are only used for cleanup and are kept separately when coalescing. */
function sameAffectedTargets(left: AffectedFile[], right: AffectedFile[]): boolean {
  const targetKey = (file: AffectedFile) => JSON.stringify([file.kind, file.schema, file.table])
  const leftKeys = new Set(left.map(targetKey))
  const rightKeys = new Set(right.map(targetKey))
  return leftKeys.size === rightKeys.size && [...leftKeys].every(key => rightKeys.has(key))
}

export class CommandManager {
  private undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []
  private persistHook: PersistHook | null = null
  private lastExecuteTime: number | null = null

  /** Registers the on-demand persistence hook (injected by the editor store) */
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

  /** Breaks coalescing of consecutive input (e.g. at a manual save boundary) without changing history or writing files. */
  breakCoalescing() {
    this.lastExecuteTime = null
  }

  /** Clears all history (e.g. on project close or reload) */
  clear() {
    this.undoStack = []
    this.redoStack = []
    this.breakCoalescing()
  }

  execute(cmd: Command) {
    cmd.apply()
    this.redoStack = []

    const files = mergeAffectedFiles(cmd.affectedFiles()).map(file => ({ ...file }))
    const now = Date.now()
    const top = this.undoStack[this.undoStack.length - 1]
    const canCoalesce =
      top &&
      top.coalesceKey !== undefined &&
      cmd.coalesceKey !== undefined &&
      top.coalesceKey === cmd.coalesceKey &&
      this.lastExecuteTime !== null &&
      now >= this.lastExecuteTime &&
      now - this.lastExecuteTime <= COALESCE_WINDOW_MS &&
      sameAffectedTargets(top.files, files)

    if (canCoalesce) {
      const mergedFiles = mergeAffectedFiles([...top.files, ...files])
      this.undoStack[this.undoStack.length - 1] = {
        label: cmd.label,
        coalesceKey: cmd.coalesceKey,
        apply: cmd.apply.bind(cmd),
        // Reuse the first closure directly, without wrapping the previous merged command, to avoid keeping the typing chain.
        revert: top.revert,
        affectedFiles: () => mergedFiles,
        files: mergedFiles,
      }
    } else {
      this.undoStack.push({
        label: cmd.label,
        coalesceKey: cmd.coalesceKey,
        apply: cmd.apply.bind(cmd),
        revert: cmd.revert.bind(cmd),
        affectedFiles: cmd.affectedFiles.bind(cmd),
        files,
      })
    }
    this.lastExecuteTime = now

    this.persistHook?.(files)
  }

  /** Undoes the previous step */
  undo() {
    this.breakCoalescing()
    const cmd = this.undoStack.pop()
    if (!cmd) return
    cmd.revert()
    this.redoStack.push(cmd)
    this.persistHook?.(cmd.affectedFiles())
  }

  /** Redoes the next step */
  redo() {
    this.breakCoalescing()
    const cmd = this.redoStack.pop()
    if (!cmd) return
    cmd.apply()
    this.undoStack.push(cmd)
    this.persistHook?.(cmd.affectedFiles())
  }
}

/** Helper functions for building affected file sets */
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

/** Merges and deduplicates affected file sets */
export function mergeAffectedFiles(files: AffectedFile[]): AffectedFile[] {
  const seen = new Set<string>()
  const result: AffectedFile[] = []
  for (const f of files) {
    const key = JSON.stringify([f.kind, f.schema, f.table, f.oldSchema, f.oldTable])
    if (seen.has(key)) continue
    seen.add(key)
    result.push(f)
  }
  return result
}

/** Convenience type: reads the current initial-data from the in-memory initialDataMap (captured by command closures) */
export type InitialDataLookup = (schema: string, table: string) => InitialData | undefined
