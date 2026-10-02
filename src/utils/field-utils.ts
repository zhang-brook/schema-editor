import type { Field } from '@/types/schema'

/**
 * 落盘前剔除字段上「无意义」的度量属性（field_length / field_scale）。
 *
 * 两类情况都视为噪音、导出时直接省略（返回新对象，不修改入参）：
 * 1. 被禁用：field_length_disabled=true 时长度已完全不参与 SQL 生成（生成链最后一步强制置 null），
 *    保留数值只会让读 JSON 的人/AI 误以为字段仍有长度。
 * 2. 被清空为 null：用户清空输入框后 parseFieldLengthInput 返回 null，而 SQL 生成侧以
 *    `!= null` / `?? null` 处理，null 与「未设置」完全等价，落盘写 "x": null 纯属冗余。
 * field_scale 同理。无改动时原样返回。
 */
export function stripDisabledFieldMetrics(field: Field): Field {
  const dropLength = field.field_length_disabled || field.field_length === null
  const dropScale = field.field_scale_disabled || field.field_scale === null
  if (!dropLength && !dropScale) return field
  const next: Field = { ...field }
  if (dropLength) delete next.field_length
  if (dropScale) delete next.field_scale
  return next
}
