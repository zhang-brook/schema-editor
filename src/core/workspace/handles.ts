/**
 * 基于 File System Access API 的目录/文件句柄获取与创建原语（业务无关）。
 *
 * 仅封装 `getDirectoryHandle` / `getFileHandle` / `removeEntry` 等底层 API，
 * 不携带任何项目特定的路径语义。业务路径规则见 `layout.ts`，语义化路径解析见 `paths.ts`。
 */

/** 获取（不存在时可选创建）子目录句柄 */
export async function getOrCreateDir(
  parent: FileSystemDirectoryHandle,
  name: string,
  create = true,
): Promise<FileSystemDirectoryHandle> {
  return parent.getDirectoryHandle(name, { create })
}

/** 获取（不存在时可选创建）文件句柄 */
export async function getFileHandleSafe(
  parent: FileSystemDirectoryHandle,
  name: string,
  create = true,
): Promise<FileSystemFileHandle> {
  return parent.getFileHandle(name, { create })
}

/** 删除目录下指定条目（文件或子目录），不存在时静默忽略 */
export async function removeEntry(
  parent: FileSystemDirectoryHandle,
  name: string,
  options?: FileSystemRemoveOptions,
): Promise<void> {
  try {
    await parent.removeEntry(name, options)
  } catch {
    // 条目不存在，静默忽略
  }
}

/** 读取文件句柄的文本并 JSON 解析，失败时抛出供调用方处理 */
export async function readJsonFile<T = unknown>(handle: FileSystemFileHandle): Promise<T> {
  const file = await handle.getFile()
  return JSON.parse(await file.text()) as T
}

/** 将对象写入文件句柄（JSON 格式化，缩进 4） */
export async function writeJsonFile(
  handle: FileSystemFileHandle,
  data: unknown,
  indent = 4,
): Promise<void> {
  const writable = await handle.createWritable()
  await writable.write(JSON.stringify(data, null, indent))
  await writable.close()
}

/** 将纯文本写入文件句柄 */
export async function writeTextFile(
  handle: FileSystemFileHandle,
  content: string,
): Promise<void> {
  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()
}
