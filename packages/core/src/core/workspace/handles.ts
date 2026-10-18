/**
 * Primitives for acquiring and creating directory/file handles based on the File System Access API (business-agnostic).
 *
 * Only wraps low-level APIs such as `getDirectoryHandle` / `getFileHandle` / `removeEntry`,
 * and carries no project-specific path semantics. Business path rules live in `layout.ts`; semantic path resolution lives in `paths.ts`.
 */

/** Get a subdirectory handle (optionally creating it when missing) */
export async function getOrCreateDir(
  parent: FileSystemDirectoryHandle,
  name: string,
  create = true,
): Promise<FileSystemDirectoryHandle> {
  return parent.getDirectoryHandle(name, { create })
}

/** Get a file handle (optionally creating it when missing) */
export async function getFileHandleSafe(
  parent: FileSystemDirectoryHandle,
  name: string,
  create = true,
): Promise<FileSystemFileHandle> {
  return parent.getFileHandle(name, { create })
}

/** Remove the specified entry (file or subdirectory) from a directory; silently ignore when missing */
export async function removeEntry(
  parent: FileSystemDirectoryHandle,
  name: string,
  options?: FileSystemRemoveOptions,
): Promise<void> {
  try {
    await parent.removeEntry(name, options)
  } catch {
    // Entry does not exist; silently ignore
  }
}

/** Read the text of a file handle and parse it as JSON; rethrow on failure for the caller to handle */
export async function readJsonFile<T = unknown>(handle: FileSystemFileHandle): Promise<T> {
  const file = await handle.getFile()
  return JSON.parse(await file.text()) as T
}

/** Write an object to a file handle (JSON formatted, 4-space indent) */
export async function writeJsonFile(
  handle: FileSystemFileHandle,
  data: unknown,
  indent = 4,
): Promise<void> {
  const writable = await handle.createWritable()
  await writable.write(JSON.stringify(data, null, indent))
  await writable.close()
}
