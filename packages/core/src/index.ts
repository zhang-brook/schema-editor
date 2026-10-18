/**
 * Public entry point of schema-editor-core.
 *
 * Domain types are the largest surface shared across clients and are exported from here by default;
 * concrete capability modules (SQL generation, workspace I/O, structure upgrades, version comparison, etc.) are imported via sub-paths,
 * e.g. `schema-editor-core/utils/sql-generator`, `schema-editor-core/core/workspace/git/providers`.
 */
export * from './types/schema'
