/** §1 总则 */
export const overviewBody = `### 总则

- 所有 JSON 字段均为**可选**，缺失即使用默认值，尽量只写需要的字段。
- 字段名一律 **snake_case**（如 \`field_name\`、\`field_length\`、\`quote_default\`）。
- 数字/布尔字段用 JSON **原生类型**，不要加引号（\`"field_length": 10\` 而非 \`"field_length": "10"\`）。
- 方言区分 **\`mysql\`** 与 **\`postgresql\`**，许多字段可独立覆盖。`
