/**
 * Unified entry point for the SQL generators.
 *
 * Generators whose signature is identical across dialects (whole-schema DDL, initial-data summary) are registered here,
 * so the store can iterate dialects uniformly instead of duplicating dispatch code for every new dialect.
 *
 * Single-table DDL (generateTableXXX) has inconsistent signatures (PostgreSQL needs schemaName), so it is not part of this registry.
 */

import type { CommonConfig, Schema, InitialData } from '../../types/schema'
import type { SqlDialect } from './shared'
import { generateSchemaMySQL, generateInitialDataAllMySQL } from './mysql'
import { generateSchemaPostgreSQL, generateInitialDataAllPostgreSQL } from './postgresql'
import { generateSchemaSQLite, generateInitialDataAllSQLite } from './sqlite'

/** Set of "whole-schema" generator functions for a single dialect */
export interface DialectGenerators {
  /** Generate the CREATE TABLE SQL for a single schema */
  schema: (schema: Schema, commonConfig: CommonConfig | null) => string
  /** Generate the initial data INSERT summary for all schemas */
  initialData: (
    schemas: Schema[],
    initialDataMap: Map<string, InitialData>,
    commonConfig: CommonConfig | null,
  ) => string
}

/** Dialect → generators map (adding a new dialect only requires one more entry here) */
export const DIALECT_GENERATORS: Record<SqlDialect, DialectGenerators> = {
  mysql: {
    schema: generateSchemaMySQL,
    initialData: generateInitialDataAllMySQL,
  },
  postgresql: {
    schema: generateSchemaPostgreSQL,
    initialData: generateInitialDataAllPostgreSQL,
  },
  sqlite: {
    schema: generateSchemaSQLite,
    initialData: generateInitialDataAllSQLite,
  },
}
