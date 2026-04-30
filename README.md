# json2sql - 数据库 Schema JSON 可视化编辑器

通过可视化界面编辑数据库 Schema 的 JSON 配置文件，编辑完成后导出 JSON，配合 `generate-sql.ts` 脚本生成对应方言的 SQL 建表语句。

## 技术栈

- **Vue 3** + **TypeScript** + **Vite**
- **Pinia** 状态管理
- 纯前端运行，无需后端服务

## 功能特性

- 导入 `common.json` 和多个 schema JSON 文件，生成左侧树形导航（Schema > Table）
- 表级编辑：表名、注释、`comment_before_table`、MySQL 表级配置
- 字段管理：表格展示字段属性，支持增删改查、`is_commented_out` 标记、`comment_before_fields` 编辑
- 索引管理：索引定义及 MySQL/PostgreSQL 覆盖配置、`pre_comment` 编辑
- 双数据库方言支持：字段类型、索引类型的 MySQL / PostgreSQL 覆盖配置
- 公共字段引用：`common_used_fields` 的查看与编辑
- Common 配置编辑：`default_config` 的查看与编辑
- 导出格式化 JSON 文件

## 快速开始

```sh
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 构建生产版本
pnpm build
```

## 项目结构

```
src/
├── App.vue                    # 根组件，布局框架
├── main.ts                    # 入口文件
├── assets/                    # 静态资源
├── components/
│   ├── EditorToolbar.vue      # 顶部工具栏（导入/导出）
│   ├── EditorSidebar.vue      # 左侧 Schema > Table 树形导航
│   ├── CommonConfigPanel.vue  # Common 配置编辑面板
│   ├── TableEditor.vue        # 表编辑面板（字段 + 索引）
│   ├── FieldTable.vue         # 字段列表编辑
│   ├── IndexTable.vue         # 索引列表编辑
│   └── AddFieldModal.vue      # 添加字段弹窗
├── stores/
│   └── editor.ts              # Pinia 编辑器状态管理
├── types/
│   └── schema.ts              # Schema 类型定义
└── utils/
    └── file-helpers.ts        # 文件导入/导出工具函数
```

## 使用说明

1. **导入 JSON**：点击顶部工具栏的导入按钮，选择 `common.json` 和一个或多个 schema JSON 文件（如 `account.json`、`memo.json`）
2. **导航**：在左侧树形导航中展开 Schema，点击表名切换编辑目标；点击 Schema 名称可编辑 Common 配置
3. **编辑**：在右侧面板中编辑表属性、字段和索引，支持 MySQL/PostgreSQL 方言覆盖
4. **导出**：点击顶部工具栏的导出按钮，将修改后的 JSON 文件保存到本地，然后配合 `generate-sql.ts` 生成 SQL
