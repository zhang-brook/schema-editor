/**
 * 结构迁移注册表与调度器。
 *
 * 设计目标：无论数据内容、字段属性，还是目录布局如何调整，新增一个版本只需要在本目录
 * 新增一个 `<from>-to-<to>.ts` 迁移脚本文件，并在下方的 STRUCTURE_MIGRATION_STEPS 注册表中
 * 追加一行即可。旧代码无需改动，天然支持「用户落后多个版本时逐个版本升级」。
 *
 * 每条 step 都是「自包含」的磁盘迁移：从当前磁盘读取 from 版本、写出 to 版本，
 * 因此 step 之间可以链式串联（step N 写入的结果即 step N+1 读取的输入）。
 *
 * 两类步骤：
 * - 字段级步骤（v0.0→v0.1、v0.1→v0.2、v0.2→v0.3、v0.3→v0.4，以及未来的 v1.0→v1.1 等）：
 *   这是**最主要、最频繁**的迁移形态——字段新增、改名、结构调整。磁盘布局不变，
 *   通过 structure-io 的 readProject/writeProject 统一读写，脚本只关注"字段怎么变"。
 * - 结构级步骤（v0.4→v1.0）：改写磁盘布局（旧 schemas/ + initial-data/ → current/ 每表文件），
 *   并清理已迁移的旧文件。
 * 所有步骤都完整走「读旧盘 → 升级 → 写盘 →（清理）」四步，互不合并。
 *
 * 未来新增字段级迁移的标准范式（无需改动 structure-io）：
 *   import { readProject, writeProject } from './structure-io'
 *   export async function migrate(rootHandle) {
 *     const data = await readProject(rootHandle, '1.0')   // 读当前盘（自动选布局）
 *     // 在此修改 data.schemas / data.common / data.initialData 的字段
 *     if (data.common) data.common.struct_version = '1.1'
 *     await writeProject(rootHandle, '1.1', data)         // 写回（自动选布局）
 *   }
 */

import { migrate as migrateV0_0ToV0_1 } from './v0_0-to-v0_1'
import { migrate as migrateV0_1ToV0_2 } from './v0_1-to-v0_2'
import { migrate as migrateV0_2ToV0_3 } from './v0_2-to-v0_3'
import { migrate as migrateV0_3ToV0_4 } from './v0_3-to-v0_4'
import type { StructureMigrationDeps } from './v0_4-to-v1_0'
import { migrate as migrateV0_4ToV1_0 } from './v0_4-to-v1_0'

/** 单条结构迁移步骤 */
export interface StructureMigrationStep {
  /** 起点版本 */
  from: string
  /** 终点版本 */
  to: string
  /**
   * 执行迁移（自包含：读 from 磁盘 → 写 to 磁盘）。
   * 数据级步骤（0.0→0.4）不需要 deps；结构级步骤（0.4→1.0）需要 deps 注入序列化函数。
   */
  migrate: (
    rootHandle: FileSystemDirectoryHandle,
    deps?: StructureMigrationDeps,
  ) => Promise<void>
}

/**
 * 结构迁移步骤注册表。
 * 每个步骤的 from 必须等于上一个步骤的 to，形成连续链条（0.0 → 0.1 → 0.2 → 0.3 → 0.4 → 1.0）。
 * 未来新增版本只需在此追加新步骤（并新建对应脚本文件）。
 */
export const STRUCTURE_MIGRATION_STEPS: StructureMigrationStep[] = [
  {
    from: '0.0',
    to: '0.1',
    migrate: migrateV0_0ToV0_1,
  },
  {
    from: '0.1',
    to: '0.2',
    migrate: migrateV0_1ToV0_2,
  },
  {
    from: '0.2',
    to: '0.3',
    migrate: migrateV0_2ToV0_3,
  },
  {
    from: '0.3',
    to: '0.4',
    migrate: migrateV0_3ToV0_4,
  },
  {
    from: '0.4',
    to: '1.0',
    migrate: migrateV0_4ToV1_0,
  },
]

/** 语义化版本比较：a < b 返回 < 0，a === b 返回 0，a > b 返回 > 0 */
function compareVersion(a: string, b: string): number {
  const aParts = a.split('.').map((n) => parseInt(n, 10) || 0)
  const bParts = b.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(aParts.length, bParts.length)
  for (let i = 0; i < len; i++) {
    const diff = (aParts[i] || 0) - (bParts[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * 从 fromVersion 开始，按注册表顺序逐个执行结构迁移，直到达到目标版本 targetVersion。
 * 支持用户落后多个版本（如 0.0 → 1.0 会依次跑 0.0→0.1、0.1→0.2、0.2→0.3、0.3→0.4、0.4→1.0）。
 *
 * @param rootHandle    项目根目录句柄
 * @param fromVersion   当前项目结构版本
 * @param deps          结构级迁移所需的序列化依赖（由调用方注入，数据级步骤不需要）
 * @param targetVersion 目标版本（默认 CURRENT_STRUCT_VERSION）
 */
export async function runStructureMigrations(
  rootHandle: FileSystemDirectoryHandle,
  fromVersion: string,
  deps: StructureMigrationDeps,
  targetVersion: string,
): Promise<void> {
  const steps = [...STRUCTURE_MIGRATION_STEPS].sort((a, b) => compareVersion(a.from, b.from))

  let current = fromVersion
  // 循环查找从 current 出发的下一步，直到达到目标版本
  // 用循环而非 forEach，以支持链式多步（每步执行后 current 推进）
  for (;;) {
    if (compareVersion(current, targetVersion) >= 0) break

    const next = steps.find((s) => compareVersion(s.from, current) === 0)
    if (!next) {
      throw new Error(
        `未找到从版本 ${current} 出发的结构迁移步骤（目标 ${targetVersion}）。请在 structure-migrations 注册表补充对应迁移脚本。`,
      )
    }

    console.log(`[structure-migration] ${next.from} → ${next.to}`)
    await next.migrate(rootHandle, deps)
    current = next.to
  }
}
