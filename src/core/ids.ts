/**
 * 唯一 id 生成工具（nanoid 封装）。
 *
 * 设计要点：
 * - 仅用于「版本」与「迁移脚本」这类仓储实体，不用于结构对象。
 * - 结构对象（schema / table / field / index / initial-data 行）不再携带唯一 id，
 *   跨版本识别 rename 由迁移脚本上累积的改名记录完成，详见 core/version/identity.ts。
 * - 带语义前缀（v_/m_）便于阅读与排错，纯随机部分使用 nanoid 避免依赖全局计数。
 */
import { customAlphabet } from 'nanoid'

// 仅使用不含易混淆字符的字母数字，避免人工阅读歧义
const alphabet = '0123456789abcdefghijkmnpqrstuvwxyz'
const generate = customAlphabet(alphabet, 10)

function makeId(prefix: string): string {
  return `${prefix}_${generate()}`
}

/** 版本（version）id，前缀 v_ */
export function newVersionId(): string {
  return makeId('v')
}

/** 迁移脚本（migration）id，前缀 m_ */
export function newMigrationId(): string {
  return makeId('m')
}

/** 环境（environment）id，前缀 e_ */
export function newEnvironmentId(): string {
  return makeId('e')
}
