/**
 * SQL 生成器统一出口。
 *
 * 各方言生成器签名一致的部分（整库建表、initial-data 汇总）在此登记，
 * 供 store 按方言统一遍历，避免每新增一个方言就复制一遍分发代码。
 *
 * 单表建表（generateTableXXX）签名不一致（PostgreSQL 需要 schemaName），故不纳入本登记表。
 */

import type { CommonConfig, Schema, InitialData } from '@/types/schema'
import type { SqlDialect } from './shared'
import { generateSchemaMySQL, generateInitialDataAllMySQL } from './mysql'
import { generateSchemaPostgreSQL, generateInitialDataAllPostgreSQL } from './postgresql'
import { generateSchemaSQLite, generateInitialDataAllSQLite } from './sqlite'

/** 单方言的「整库级」生成函数集合 */
export interface DialectGenerators {
  /** 生成单个 schema 的建表 SQL */
  schema: (schema: Schema, commonConfig: CommonConfig | null) => string
  /** 生成所有 schema 的 initial data INSERT 汇总 */
  initialData: (
    schemas: Schema[],
    initialDataMap: Map<string, InitialData>,
    commonConfig: CommonConfig | null,
  ) => string
}

/** 方言 → 生成器映射（新增方言时只需在此补一项） */
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
