/** §5 schema.json 与 table.json */
export const schemaTableBody = `### schema.json 与 table.json

#### schema.json

\`\`\`jsonc
{ "schema": "my_schema", "table_order": ["users", "orders"] }
\`\`\`

#### table.json（核心）

\`\`\`jsonc
{
  "name": "users",
  "comment": "用户表",
  "comment_before_table": "-- 表前注释",
  "comment_before_fields": { "age": "-- 字段前注释" },
  "mysql": { "mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collation": "utf8mb4_0900_ai_ci" },
  "fields": [ /* Field[] 见下 */ ],
  "indexes": [ /* Index[] 见下 */ ],
  "partition": {
    "mysql":      { "strategy": "RANGE", "columns": ["created_at"] },
    "postgresql": { "expression": "RANGE (to_days(created_at))" }
  },
  "pre_sql":  { "mysql": "", "postgresql": "" },
  "post_sql": { "mysql": "", "postgresql": "" }
}
\`\`\`
- \`comment_before_table\`：字符串或字符串数组（\`null\` 元素表示空行）。
- \`partition\`：分区表配置，按方言分别设置（\`{ mysql?, postgresql? }\`）。每个方言子配置支持两种写法：
  - 结构化：\`{ "strategy": "RANGE|LIST|HASH|KEY|RANGE COLUMNS|LIST COLUMNS", "columns": ["col1","col2"] }\` → 生成 \`PARTITION BY <strategy> (col1, col2)\`
  - 原始兜底：\`{ "expression": "RANGE (YEAR(created_at))" }\` → 生成 \`PARTITION BY <expression>\`（用于覆盖各方言差异，如 MySQL 的 \`KEY\`、PostgreSQL 的 \`RANGE (to_days(...))\` 等）
  - 生成位置：紧跟在 \`CREATE TABLE (...)\` 的右括号之前。
- \`pre_sql\`/\`post_sql\`：\`{ mysql?, postgresql? }\`，写盘时自动补分号。`
