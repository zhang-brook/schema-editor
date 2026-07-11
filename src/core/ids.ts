/**
 * 唯一 id 生成工具（nanoid 封装）。
 *
 * 设计要点（见 docs/refactor/15）：
 * - field_id / table_id / schema_id 为「延迟生成」——平时不生成，保持无基线用户数据干净。
 * - 仅当用户创建首个基线时，才在当前内存态/磁盘补齐所有缺失的 id。
 * - 之后用户处于「有基线」状态，新增表/字段自动带 id。
 * - 带语义前缀（f_/t_/s_）便于阅读与排错，纯随机部分使用 nanoid 避免依赖全局计数（改名后不歧义）。
 */
import { customAlphabet } from 'nanoid'

// 仅使用不含易混淆字符的字母数字，避免人工阅读歧义
const alphabet = '0123456789abcdefghijkmnpqrstuvwxyz'
const generate = customAlphabet(alphabet, 10)

function makeId(prefix: string): string {
  return `${prefix}_${generate()}`
}

export function newFieldId(): string {
  return makeId('f')
}

export function newTableId(): string {
  return makeId('t')
}

export function newSchemaId(): string {
  return makeId('s')
}

export function newBaselineId(): string {
  return makeId('b')
}

export function newMigrationId(): string {
  return makeId('m')
}
