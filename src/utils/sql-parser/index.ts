/**
 * SQL 解析器 — 统一导出入口
 *
 * 用法:
 *   import { parseCreateTableStatements, detectDialect } from '@/utils/sql-parser'
 *   const result = parseCreateTableStatements(sqlText)
 *   const dialect = detectDialect(sqlText)
 */

export { lex, tokenize, mergeCompoundKeywords } from './tokenizer'
export type { Token } from './tokenizer'

export { parseCreateTableStatements } from './create-table-parser'
export type {
  ParsedColumn,
  ParsedConstraint,
  ParsedConstraintColumn,
  ParsedTableOptions,
  ParsedTable,
  ParseMessage,
  ParseResult,
} from './create-table-parser'

export { mapSqlTypeToField, convertColumnToField } from './type-mapper'
export type { TypeMappingResult } from './type-mapper'

export { detectDialect, detectDialectFromTokens } from './dialect-detector'
export type { DetectedDialect } from './dialect-detector'
