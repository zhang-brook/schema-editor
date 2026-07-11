import { migrate as migrateV0_0ToV0_1 } from './v0_0-to-v0_1'
import { migrate as migrateV0_1ToV0_2 } from './v0_1-to-v0_2'
import { migrate as migrateV0_2ToV0_3 } from './v0_2-to-v0_3'
import { migrate as migrateV0_3ToV0_4 } from './v0_3-to-v0_4'
import type { StructureMigrationDeps } from './v0_4-to-v1_0'
import { migrate as migrateV0_4ToV1_0 } from './v0_4-to-v1_0'

export interface StructureMigrationStep {
  from: string
  to: string
  migrate: (
    rootHandle: FileSystemDirectoryHandle,
    deps?: StructureMigrationDeps,
  ) => Promise<void>
}

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
