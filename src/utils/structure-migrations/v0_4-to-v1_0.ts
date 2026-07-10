/**
 * 结构迁移脚本：v0.4 → v1.0
 *
 * 这是一条「完整磁盘布局迁移」：读取旧结构（根 common.json + schemas/*.json + initial-data/*），
 * 改写为新结构（current/ 每表独立文件 + 行内化初始数据），并清理已迁移的旧文件
 * （杜绝回退导致新结构字段丢失）。
 *
 * 设计为「自包含」：每个 step 文件都从当前磁盘读取 from 版本、写出 to 版本，
 * 因此支持用户落后多个版本时「逐个版本」依次跑（见 structure-migrations/index.ts 的注册表）。
 * 注意：0.0→0.4 的数据级字段升级已由单独的 v0_x-to-v0_y 步骤在旧盘上逐一完成，
 * 本步骤拿到的内存态 oldSchemas 已是 0.4 数据态，只需做布局层面的改写。
 *
 * 说明：「0.4」是数据级升级链的当前末端版本，旧磁盘格式（schemas/ 平行目录 +
 * initial-data/ 平行目录）对应的结构版本即记为 0.4；「1.0」是引入 current/ 新布局后的
 * 第一个结构版本（= CURRENT_STRUCT_VERSION）。本步骤同时完成 initial-data 行内化
 * （读旧盘时经 normalizeInitialData 转行内、写新盘时经 buildInitialDataExport 只写行内）。
 */

import {
  readOldSchemasFromHandle,
  readInitialDataFromHandle,
  migrateOldToNewStructure,
  cleanupOldStructure,
} from '@/utils/file-helpers'
import { readProject } from './structure-io'

/** 本步骤的终点版本（引入 current/ 新布局后的第一个结构版本） */
const V1_0 = '1.0'

/** 结构迁移依赖（由调度器注入） */
export interface StructureMigrationDeps {
  /** 将内存态单表序列化为可写出的 table.json 对象 */
  transformTable: (schema: any, table: any) => any
}

/**
 * 执行 v0.4 → v1.0 迁移。
 * @param rootHandle 项目根目录句柄
 * @param deps 注入的序列化函数
 */
export async function migrate(
  rootHandle: FileSystemDirectoryHandle,
  deps?: StructureMigrationDeps,
): Promise<void> {
  if (!deps) throw new Error('[v0_4-to-v1_0] transformTable 依赖未注入')
  // 1. 读取旧结构（每个 step 都从磁盘重新读取，支持链式多版本升级）
  const oldCommon = (await readProject(rootHandle, '0.4')).common
  const oldSchemas = await readOldSchemasFromHandle(rootHandle)
  const oldInitialData = await readInitialDataFromHandle(rootHandle)

  // 2. 数据级升级已在 0.0→0.4 各独立步骤中完成，此处内存态 oldSchemas 已是 0.4 数据态
  //    仅推进到本步骤终点 1.0（后续 1.0→1.1 由独立步骤链式接力，不可在此直接跳到最终版本）
  if (oldCommon) oldCommon.struct_version = V1_0

  // 3. 构造新结构写盘数据
  const newCommon = oldCommon ?? { struct_version: V1_0 }
  // 将 schema_order 从根 common 迁入 database.json：
  // - 旧 common 中若存在 schema_order，原样沿用（必须和之前保持一致）；
  // - 旧 common 中若不存在，则不写该字段（使用方 applySchemaOrder 已兼容「排序不存在」的情况，
  //   缺失时会按内存/目录顺序展示，属于预期行为，不应凭空生成顺序）。
  //   注意：必须在 delete 之前先取出，因为 newCommon 与 oldCommon 是同一对象引用，
  //   若先 delete 再读会得到 undefined，导致 schema_order 丢失。
  const preservedSchemaOrder =
    oldCommon && Array.isArray(oldCommon.schema_order) && oldCommon.schema_order.length > 0
      ? (oldCommon.schema_order as string[])
      : undefined
  delete newCommon.schema_order
  const databaseData: { schema_order?: string[] } = {}
  if (preservedSchemaOrder) {
    databaseData.schema_order = preservedSchemaOrder
  }

  // 4. 写入新结构（current/ 每表独立文件 + 行内化初始数据）
  await migrateOldToNewStructure(rootHandle, {
    commonConfig: newCommon,
    databaseData,
    schemas: oldSchemas,
    transformTable: deps.transformTable,
    initialData: oldInitialData,
  })

  // 5. 清理已迁移的旧文件（升级了哪里就处理哪里）
  const oldInitialDataKeys = oldInitialData.map((x) => x.key)
  await cleanupOldStructure(rootHandle, oldSchemas, oldInitialDataKeys)
}
