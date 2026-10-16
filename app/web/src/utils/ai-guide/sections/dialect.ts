/** §9 方言覆盖通用规则 */
export const dialectBody = `### 方言覆盖通用规则

许多字段支持方言级覆盖子对象（\`mysql\` / \`postgresql\` / \`sqlite\`），读取时遵循「方言优先，其次顶层，最后回退」：

- \`Field.mysql\` / \`Field.postgresql\` / \`Field.sqlite\`：\`{ field_type?, field_length?, field_scale?, default? }\`
- \`Index.mysql\` / \`Index.postgresql\` / \`Index.sqlite\`：\`{ type?, name?, using? }\`（postgresql / sqlite 无 \`using\`）
- \`IndexColumn.mysql\` / \`IndexColumn.postgresql\` / \`IndexColumn.sqlite\`：\`{ sort_order?: 'ASC'|'DESC' }\`
- \`Table/Schema/InitialData\` 的 \`pre_sql\` / \`post_sql\`：均为 \`{ mysql?, postgresql?, sqlite? }\`

#### SQLite 方言与另两者的差异

- **无 \`CREATE SCHEMA\`**：\`schema\` 对应数据库文件（或 \`ATTACH\` 别名），生成时只输出 \`-- Schema: <name>\` 注释，表名不带 schema 前缀。
- **无 \`COMMENT\` 语法**：表注释落在表头注释块，字段注释与索引注释以独立的 \`-- ...\` 行输出。
- **无 \`PARTITION BY\`**：\`partition.sqlite\` 仅为结构占位，不会生成任何子句。
- **类型亲和（type affinity）**：统一类型按官方规则映射为 INTEGER / REAL / NUMERIC / TEXT / BLOB。
- 外键开关使用 \`PRAGMA foreign_keys = OFF / ON\`（对应 MySQL 的 \`SET FOREIGN_KEY_CHECKS\`）。`
