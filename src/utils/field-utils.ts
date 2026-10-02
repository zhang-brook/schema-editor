import type { Field } from '@/types/schema'

/**
 * 落盘前剔除字段上「已被禁用」的度量属性。
 *
 * field_length_disabled=true 时 field_length 完全不参与 SQL 生成（生成链最后一步强制置 null），
 * 保留该数值纯属噪音，会让读 JSON 的人/AI 误以为字段仍有长度，故导出时直接省略。
 * field_scale 同理。返回新对象，不修改入参。
 */
export function stripDisabledFieldMetrics(field: Field): Field {
  if (!field.field_length_disabled && !field.field_scale_disabled) return field
  const next: Field = { ...field }
  if (next.field_length_disabled) delete next.field_length
  if (next.field_scale_disabled) delete next.field_scale
  return next
}
