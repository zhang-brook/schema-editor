/** §7 Index（索引） */
export const indexBody = `### Index（索引）

\`\`\`jsonc
{
  "name": "idx_user_email",        // 可选
  "index_id": "i_xxx",             // 可选；跨版本识别用
  "type": "unique",                // 必填：仅 "index" 或 "unique"
  "using": "BTREE",                // 仅 MySQL（USING BTREE/HASH）
  "columns": [                     // IndexColumn[]（结构化，取代旧版纯字符串）
    { "name": "email", "sort_order": "ASC", "mysql": { "sort_order": "DESC" } },
    { "name": "status" }
  ],
  "comment": "邮箱唯一索引",
  "pre_comment": "-- 索引前注释",
  "mysql":      { "type": "unique", "name": "uk_xxx", "using": "BTREE" },
  "postgresql": { "type": "unique", "name": "uk_xxx" }  // postgresql 无 using
}
\`\`\`

- \`type\` 合法值只有 \`"index"\`（普通）/ \`"unique"\`（唯一）。如需 FULLTEXT 等请用 \`pre_sql\`/\`post_sql\` 自定义。
- \`columns\`：每个含 \`name\`（必填）、\`sort_order\`（可选 \`ASC\`/\`DESC\`）、方言级 \`sort_order\` 覆盖。
- **主键**：不要写成 Index，直接在 Field 上设 \`"primary_key": true\`。
- 索引名占位符：\`{pre}\` 替换为 \`idx_\`（普通）或 \`uk_\`（唯一），\`{post}\` 替换为空。
- PostgreSQL：唯一索引生成 \`CONSTRAINT ... UNIQUE (...)\`，普通索引生成 \`CREATE INDEX ...\`；覆盖中的 \`using\` 被忽略。`
