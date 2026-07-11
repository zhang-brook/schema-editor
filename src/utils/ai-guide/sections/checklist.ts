/** §10 AI 改 JSON 前快速核查清单 */
export const checklistBody = `### AI 改 JSON 前快速核查清单

- [ ] 字段名 snake_case，缺失字段用默认值，不冗余填写。
- [ ] 数字/布尔用 JSON 原生类型，**不加引号**。
- [ ] **长度与小数位分开写**：\`field_length\` + \`field_scale\`，绝不用 \`"10,6"\`。
- [ ] 字符串默认值确认 \`quote_default\` 为 \`true\`（优先用 \`unified_type\` 继承）。
- [ ] 主键用字段 \`primary_key: true\`，不要写成索引。
- [ ] 索引 \`type\` 只用 \`index\` / \`unique\`。
- [ ] \`schema_order\` 写在 \`current/database.json\`，不在 \`common.json\`。
- [ ] 引用公共字段：\`use_common_used_fields: true\` + 同 \`field_name\`，且 \`common_used_fields\` 中已定义。
- [ ] 初始数据用行内 \`rows\` 结构，跳过行用 \`is_skip: true\`。`
