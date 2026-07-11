/** §3 common.json */
export const commonBody = `### common.json

\`\`\`jsonc
{
  "struct_version": "1.0",   // 结构版本号，当前 CURRENT_STRUCT_VERSION = "1.0"
  "default_config": { "...": "见下" },
  "common_used_fields": { "id": { "field_name": "id", "unified_type": "BigInt", "primary_key": true } },
  "common_used_field_order": ["id"],  // 仅 UI 顺序
  "unified_types": [ "..." ],        // 统一顶层类型（见下）
  "type_case": "keep",               // keep | lowercase | uppercase | pascal
  "generate_ai_guide": false         // 是否生成本 AI 指南（项目级开关，默认不生成）
}
\`\`\`

> **注意**：\`schema_order\` 在新结构中**不**在 common.json，而写在 \`current/database.json\`。

#### default_config

\`\`\`jsonc
{
  "default_config": {
    "table_ddl_mode": "drop_and_create", // create | drop_and_create | create_if_not_exists
    "mysql": {
      "database": {},
      "table": { "mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collation": "utf8mb4_0900_ai_ci" },
      "pre_sql": "", "post_sql": ""
    },
    "postgresql": {
      "quote_identifiers": true, // true → 标识符加双引号 "name"
      "pre_sql": "", "post_sql": ""
    }
  }
}
\`\`\`

#### unified_types（统一类型）

每个条目映射到各方言的具体类型，避免重复填写。结构：\`{ name, description?, quote_default?, default_input?, mysql: {type,length?,scale?}, postgresql: {type,length?,scale?} }\`。

- 内置默认集（\`src/utils/unified-types.ts\`）：String/Integer/BigInt/Boolean/Text/LongText/Decimal/Float/Double/Date/DateTime/Timestamp/JSON/UUID。
- 字段引用：在 Field 上写 \`"unified_type": "Decimal"\`，继承其 \`type/length/scale\` 与 \`quote_default\`。`
