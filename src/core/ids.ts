/**
 * 唯一 id 生成工具（nanoid 封装）。
 *
 * 设计要点：
 * - field_id / table_id / schema_id / index_id / initial_data_id（行级）在「创建对象时即生成」——
 *   无论是否已创建基线，新增的 schema/table/field/index/initial-data 行都自动带 id，
 *   加载已有项目时也会补齐磁盘上缺失的 id，保证可跨版本识别 rename。
 * - 带语义前缀（f_/t_/s_/i_/d_）便于阅读与排错，纯随机部分使用 nanoid 避免依赖全局计数（改名后不歧义）。
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

/** 初始数据行（initial-data row）唯一 id，前缀 d_ */
export function newInitialDataId(): string {
  return makeId('d')
}

/** 索引（index）唯一 id，前缀 i_ */
export function newIndexId(): string {
  return makeId('i')
}

export function newMigrationId(): string {
  return makeId('m')
}
