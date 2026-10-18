// global.d.ts
import type { DesktopBridge } from 'schema-editor-bridge'

declare global {
  interface Window {
    // MDN docs: https://developer.mozilla.org/zh-CN/docs/Web/API/Window/showDirectoryPicker
    showDirectoryPicker(options?: {
      id?: string
      mode?: 'read' | 'readwrite'
      startIn?: FileSystemHandle
    }): Promise<FileSystemDirectoryHandle>

    /** File system bridge injected by the desktop shell; absent in the web environment */
    schemaEditorDesktop?: DesktopBridge

    FileSystemObserver: typeof FileSystemObserver
  }

  /**
   * getAsFileSystemHandle — a Chromium-specific drag-and-drop extension that turns a
   * dropped DataTransferItem into a file system handle.
   * Not yet standardized, so it is missing from lib.dom; declared as optional here.
   */
  interface DataTransferItem {
    getAsFileSystemHandle?(): Promise<FileSystemHandle | null>
  }

  // FileSystemObserver - experimental File System API
  // @see https://developer.mozilla.org/en-US/docs/Web/API/FileSystemObserver
  class FileSystemObserver {
    constructor(callback: (records: FileSystemObserverRecord[], observer: FileSystemObserver) => void)
    observe(handle: FileSystemHandle, options?: { recursive?: boolean }): Promise<void>
    disconnect(): void
  }

  interface FileSystemObserverRecord {
    readonly changedHandle: FileSystemFileHandle | FileSystemDirectoryHandle
    readonly type: 'appeared' | 'disappeared' | 'modified' | 'moved'
    readonly relativePathComponents: readonly string[]
    readonly relativePathMovedFrom?: readonly string[]
  }
}

export {}
