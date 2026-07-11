/** §8 initial-data.json（初始数据） */
export const initialDataBody = `### initial-data.json（初始数据）

采用**行内结构**（取代旧版四个平行数组）：

\`\`\`jsonc
{
  "rows": [
    {
      "data": { "id": 1, "name": "Alice", "status": "active" },
      "initial_data_id": "d_xxx",     // 可选
      "field_comments": { "name": "姓名" },  // 可选：字段级注释
      "is_skip": false,               // true → 该行不生成 INSERT
      "row_comment": "示例行"          // 可选：行级注释
    }
  ],
  "pre_sql":  { "mysql": "", "postgresql": "" },
  "post_sql": { "mysql": "", "postgresql": "" }
}
\`\`\`

- \`rows\` 缺省为 \`undefined\`（未初始化板块）；空表为 \`[]\`。
- \`data\` 值为 JSON 原生类型；对象/数组会 \`JSON.stringify\` 后作为字符串字面量插入（带引号）。
- \`is_skip: true\` 的行被完全跳过。
- INSERT 列名取自表中**未被 \`is_commented_out\` 注释掉**的字段（顺序为表字段顺序）。`
