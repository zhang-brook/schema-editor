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
  "pre_sql":  { "mysql": "", "postgresql": "" },
  "post_sql": { "mysql": "", "postgresql": "" }
}
\`\`\`
- \`comment_before_table\`：字符串或字符串数组（\`null\` 元素表示空行）。
- \`pre_sql\`/\`post_sql\`：\`{ mysql?, postgresql? }\`，写盘时自动补分号。`
