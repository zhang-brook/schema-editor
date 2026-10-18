import type { Field } from '../types/schema'

/**
 * Strips meaningless metric attributes (field_length / field_scale) from a field before persisting.
 *
 * Both cases count as noise and are omitted on export (returns a new object, does not mutate the input):
 * 1. Disabled: when field_length_disabled=true the length no longer participates in SQL generation at all
 *    (the last step of the generation chain forces it to null), so keeping the value only makes
 *    humans/AI reading the JSON think the field still has a length.
 * 2. Cleared to null: after the user empties the input, parseFieldLengthInput returns null, and the SQL
 *    generation side handles it with `!= null` / `?? null`, so null is fully equivalent to "not set" and
 *    writing "x": null to disk is pure redundancy.
 * Same for field_scale. Returns the original when nothing changes.
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
