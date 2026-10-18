/**
 * Version on-disk read/write layer.
 *
 * Storage: versions/<id>.json (a single file holding the full snapshot).
 * Implemented with pure functions + FS primitives; holds no reactive state, so stores can call it directly.
 */
import { getVersionsDir, getVersionFileHandle } from '../workspace/paths'
import { readJsonFile, writeJsonFile, removeEntry } from '../workspace/handles'
import type { VersionSnapshot, VersionSummary } from './types'

/** Version file name suffix */
const VERSION_FILE_SUFFIX = '.json'

/** List all version summaries (ascending by creation time, oldest first) */
export async function listVersions(
  rootHandle: FileSystemDirectoryHandle,
): Promise<VersionSummary[]> {
  let versionsDir: FileSystemDirectoryHandle
  try {
    versionsDir = await getVersionsDir(rootHandle, false)
  } catch {
    return []
  }

  const summaries: VersionSummary[] = []
  for await (const entry of versionsDir.values()) {
    if (entry.kind !== 'file') continue
    if (!entry.name.endsWith(VERSION_FILE_SUFFIX)) continue
    try {
      const data = await readJsonFile<VersionSnapshot>(entry as FileSystemFileHandle)
      if (!data?.id) continue
      summaries.push({
        id: data.id,
        name: data.name,
        created_at: data.created_at,
        ...(data.parent_id ? { parent_id: data.parent_id } : {}),
      })
    } catch {
      // Skip corrupted version files
    }
  }

  summaries.sort((a, b) => a.created_at.localeCompare(b.created_at))
  return summaries
}

// Avoid unused-import warnings (listDirEntries is reserved for future extensions)
void removeEntry

/** Read a single full version snapshot */
export async function readVersion(
  rootHandle: FileSystemDirectoryHandle,
  id: string,
): Promise<VersionSnapshot | null> {
  try {
    const versionsDir = await getVersionsDir(rootHandle, false)
    const handle = await getVersionFileHandle(versionsDir, id, false)
    const data = await readJsonFile<VersionSnapshot>(handle)
    return data ?? null
  } catch {
    return null
  }
}

/** Write a version snapshot (deep copy, so external mutation cannot affect it) */
export async function writeVersion(
  rootHandle: FileSystemDirectoryHandle,
  snapshot: VersionSnapshot,
): Promise<void> {
  const versionsDir = await getVersionsDir(rootHandle)
  const handle = await getVersionFileHandle(versionsDir, snapshot.id)
  await writeJsonFile(handle, JSON.parse(JSON.stringify(snapshot)))
}

/** Delete a version */
export async function deleteVersion(
  rootHandle: FileSystemDirectoryHandle,
  id: string,
): Promise<void> {
  try {
    const versionsDir = await getVersionsDir(rootHandle, false)
    await removeEntry(versionsDir, `${id}${VERSION_FILE_SUFFIX}`)
  } catch {
    // Ignore if it no longer exists
  }
}
