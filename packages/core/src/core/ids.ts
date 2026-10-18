/**
 * Unique id generation utilities (nanoid wrapper).
 *
 * Design notes:
 * - Only for repository entities such as "versions" and "migration scripts", not for structural objects.
 * - Structural objects (schema / table / field / index / initial-data rows) no longer carry unique ids;
 *   renames across versions come from accumulated rename records on migrations, see core/version/identity.ts.
 * - Semantic prefixes (v_/m_) aid readability and debugging; the random part uses nanoid, not a global counter.
 */
import { customAlphabet } from 'nanoid'

// use only alphanumerics without easily confused characters to avoid ambiguity when read by humans
const alphabet = '0123456789abcdefghijkmnpqrstuvwxyz'
const generate = customAlphabet(alphabet, 10)

function makeId(prefix: string): string {
  return `${prefix}_${generate()}`
}

/** Version id with the v_ prefix */
export function newVersionId(): string {
  return makeId('v')
}

/** Migration script id with the m_ prefix */
export function newMigrationId(): string {
  return makeId('m')
}

/** Environment id with the e_ prefix */
export function newEnvironmentId(): string {
  return makeId('e')
}
