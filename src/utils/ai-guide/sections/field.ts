/** §6 Field（字段）详解 */
export const fieldBody = `### Field（字段）详解

\`\`\`jsonc
{
  "field_name": "price",
  "field_id": "f_xxx",            // 可选；跨版本识别 rename
  "use_common_used_fields": false,
  "unified_type": "Decimal",       // 可选；引用 common.unified_types 的名称
  "field_type": "DECIMAL",         // 可选；自定义类型（自由文本）
  "field_length": 10,              // ⚠️ 数字！不是 "10,6"
  "field_scale": 2,                // ⚠️ 单独写！不要和 length 合在一起
  "field_length_disabled": false,  // true → 强制跳过长度输出（不生成 (N)）
  "field_scale_disabled": false,   // true → 强制跳过小数位输出
  "not_null": true,
  "primary_key": false,
  "quote_default": false,           // ⚠️ 见下
  "default": 0,
  "comment": "价格",
  "is_commented_out": false,       // true → 该字段在 SQL 中被注释掉（不生成）
  "mysql":      { "field_type": "...", "field_length": 1, "field_scale": 0, "default": "..." },
  "postgresql": { "field_type": "...", "field_length": 1, "field_scale": 0, "default": "..." }
}
\`\`\`

#### 类型解析优先级

\`resolveFieldTypeForDialect\` 按以下顺序确定最终 \`type\` / \`length\` / \`scale\`：

1. **unified_type 映射**（查 \`common.unified_types\` 得到方言 \`type/length/scale\`）
2. **字段级 bare 属性** \`field_type\` / \`field_length\` / \`field_scale\`
3. **方言覆盖** \`field.mysql.*\` / \`field.postgresql.*\`
4. **最终裁决**：\`field_length_disabled === true\` → \`length = null\`；\`field_scale_disabled === true\` → \`scale = null\`

SQL 长度输出：同时有 length+scale → \`TYPE(length,scale)\`；仅 length → \`TYPE(length)\`；都没有 → \`TYPE\`。

#### ⚠️ field_length / field_scale 常见错误

- **错误**：\`"field_length": "10,6"\` 或 \`"field_length": "10,2"\`。
  **原因**：\`field_length\` 类型是 \`number | null\`，只有 \`typeof === 'number'\` 才输出 \`(N)\`；字符串 \`"10,6"\` 不是数字，会被忽略。
  **正确**：
  \`\`\`jsonc
  "field_length": 10,
  "field_scale": 6
  \`\`\`
- 二者是**分开的两个字段**，不要拼成 \`"10,6"\`；且必须是**数字**，不要写成字符串。
- 只想输出类型不带长度（如 \`TEXT\`、\`JSON\`、\`DATETIME\`）：省略 \`field_length\`/\`field_scale\`，或置 \`field_length_disabled: true\`。

#### ⚠️ quote_default 用法

决定字段 \`DEFAULT\` 值是否被单引号包裹。解析优先级：\`field.quote_default\` → \`unified_type.quote_default\` → 默认 \`false\`。

- **\`true\` 何时用**：\`default\` 是**字符串字面量**（如 \`'active'\`、\`'2024-01-01'\`）时，必须 \`true\`，否则生成 \`DEFAULT active\`（非法 SQL）。
  内置示例：String/Text/LongText/Date/DateTime/Timestamp/JSON/UUID 的 \`quote_default=true\`；Integer/BigInt/Boolean/Decimal/Float/Double 为 \`false\`。
- **\`false\` 何时用**：\`default\` 是数字、布尔、或 SQL 表达式（如 \`CURRENT_TIMESTAMP\`）。
  **注意**：\`CURRENT_TIMESTAMP\` 等 SQL 表达式**无论 quote_default 是什么都原样输出**。
- 引用了 \`unified_type\` 时一般继承即可，无需显式写；未用 \`unified_type\` 或想覆盖时才显式设置。

\`\`\`jsonc
// 字符串默认值 → 必须 quote_default: true（用 unified_type 继承最常见）
{ "field_name": "status", "unified_type": "String", "default": "active" }
// 自定义类型字符串默认值
{ "field_name": "code", "field_type": "VARCHAR", "default": "X", "quote_default": true }
// 数字默认值 → quote_default: false（默认）
{ "field_name": "count", "unified_type": "Integer", "default": 0 }
// SQL 表达式 → 不用管 quote_default
{ "field_name": "created_at", "unified_type": "DateTime", "default": "CURRENT_TIMESTAMP" }
\`\`\`

#### default 值细节

- \`default\` 类型为 \`any\`，按 JSON 原生类型写（字符串写字符串，数字写数字，布尔写布尔）。
- \`default_input: "boolean"\` 时 UI 用 TRUE/FALSE 下拉，底层存 \`true\`/\`false\`。
- \`default\` 经方言覆盖解析：方言 \`default\` 优先于顶层 \`default\`。
- 字段对象中无 \`default\` key → 不生成 \`DEFAULT\` 子句。`
