/**
 * schema-editor-core 对外入口。
 *
 * 领域类型是各端共用的最大面，默认从此处取；
 * 需要具体能力模块（SQL 生成、工作区读写、结构升级、版本比较等）时按子路径引用，
 * 例如 `schema-editor-core/utils/sql-generator`、`schema-editor-core/core/workspace/git/providers`。
 */
export * from './types/schema'
