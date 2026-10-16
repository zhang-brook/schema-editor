// 方言解析辅助层：统一收敛带方言覆盖的属性读取，避免散落的 `obj.mysql?.attr ?? obj.attr ?? fallback` 写法。

import type { SqlDialect } from "./sql-generator/shared"

/**
 * 读取带方言覆盖的属性：方言优先，其次顶层同名属性，最后回退默认值。
 * 等价于 `obj[dialect]?.[key] ?? obj[key] ?? fallback`。
 *
 * @typeParam T - 实体类型（如 Field / Index / IndexColumn）
 * @typeParam K - T 的顶层键名，`key` 受此约束以获得类型提示
 * @param obj - 目标实体对象
 * @param dialect - 当前方言
 * @param key - 待读取的属性键
 * @param fallback - 未命中时的回退值
 * @returns 最终解析出的属性值
 */
export function resolveDialectOverride<T, K extends keyof T & string>(
  obj: T | null | undefined,
  dialect: SqlDialect,
  key: K,
  fallback?: T[K]
): T[K] {
  const dialectVal = (obj as any)?.[dialect]?.[key]
  if (dialectVal !== undefined) return dialectVal as T[K]
  const topVal = obj?.[key]
  if (topVal !== undefined) return topVal
  return fallback as T[K]
}

/**
 * 仅读取方言子对象上的覆盖值，未命中时回退 `fallback`（不回退顶层同名属性）。
 * 等价于 `obj[dialect]?.[key] ?? fallback`。
 *
 * @typeParam T - 实体类型
 * @typeParam K - T 的顶层键名，`key` 受此约束以获得类型提示
 * @param obj - 目标实体对象
 * @param dialect - 当前方言
 * @param key - 待读取的属性键
 * @param fallback - 未命中时的回退值
 * @returns 方言子对象上的属性值或回退值
 */
export function getDialectOverrideValue<T, K extends keyof T & string>(
  obj: T | null | undefined,
  dialect: SqlDialect,
  key: K,
  fallback?: T[K]
): T[K] {
  const dialectVal = (obj as any)?.[dialect]?.[key]
  return dialectVal !== undefined ? (dialectVal as T[K]) : (fallback as T[K])
}

/**
 * 读取仅存在于方言子对象的配置项（如 `table.mysql.mysql_engine`），不存在时回退 `fallback`。
 * 与 `getDialectOverrideValue` 不同：此类属性不存在顶层同名键，因此不会回退顶层。
 *
 * @typeParam O - 方言子对象类型（如 TableMysqlConfig / FieldOverride）
 * @typeParam K - O 的键名，`key` 受此约束以获得类型提示
 * @param subConfig - 方言子对象
 * @param key - 待读取的属性键
 * @param fallback - 未命中时的回退值
 * @returns 方言子对象上的属性值或回退值
 */
export function getDialectSubConfig<O, K extends keyof O & string>(
  subConfig: O | null | undefined,
  key: K,
  fallback?: O[K]
): O[K] {
  const val = subConfig?.[key]
  return val !== undefined ? val : (fallback as O[K])
}
