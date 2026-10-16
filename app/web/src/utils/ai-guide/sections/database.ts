/** §4 current/database.json */
export const databaseBody = `### current/database.json

\`\`\`jsonc
{ "schema_order": ["my_schema", "another_schema"] }
\`\`\`
- 仅含 \`schema_order?: string[]\`，决定 schema 顺序；缺失时按目录顺序。`
