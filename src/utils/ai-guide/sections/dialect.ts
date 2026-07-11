/** §9 方言覆盖通用规则 */
export const dialectBody = `### 方言覆盖通用规则

许多字段支持方言级覆盖子对象（\`mysql\` / \`postgresql\`），读取时遵循「方言优先，其次顶层，最后回退」：

- \`Field.mysql\` / \`Field.postgresql\`：\`{ field_type?, field_length?, field_scale?, default? }\`
- \`Index.mysql\` / \`Index.postgresql\`：\`{ type?, name?, using? }\`（postgresql 无 \`using\`）
- \`IndexColumn.mysql\` / \`IndexColumn.postgresql\`：\`{ sort_order?: 'ASC'|'DESC' }\`
- \`Table/Schema/InitialData\` 的 \`pre_sql\` / \`post_sql\`：均为 \`{ mysql?, postgresql? }\``
