/** §2 目录布局 */
export const layoutBody = `### 目录布局（用户打开的文件夹）

\`\`\`
your-schema-folder/
├── common.json            # 根配置：默认配置 / 统一类型 / 公共字段
└── current/              # 当前正在编辑的版本（固定名）
    ├── database.json     # { schema_order?: string[] }
    └── schemas/
        └── <schema>/    # 文件名友好的 schema 名（经 sanitizeName）
            ├── schema.json        # { schema: 原始名, table_order?: string[] }
            └── <table>/          # 文件名友好的 table 名
                ├── table.json            # 单表定义
                └── initial-data.json    # 表初始数据（行内结构，可选）
\`\`\`

- \`sanitizeName(name)\`：将原始名转安全文件名（非法字符→\`_\`，折叠连续下划线，去首尾下划线），保留大小写。原始语义名存于 \`schema.json\` / \`table.json\` 内。`
