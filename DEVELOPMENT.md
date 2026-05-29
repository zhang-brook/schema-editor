# 开发指南

本文档面向参与 schema-editor 开发的成员，涵盖技术栈、项目结构、架构设计和质量保障体系。

## 技术栈

- **Vue 3** + **TypeScript** + **Vite**
- **Pinia** 状态管理
- **File System Access API** — 打开本地文件夹，编辑内容实时同步保存
- 纯前端运行，无需后端服务

## 项目结构

```
src/
├── App.vue                      # 根组件，整体布局框架（工具栏 + 侧边栏 + 编辑区）
├── main.ts                      # 入口文件，挂载 Vue 应用 & Pinia
├── components/
│   ├── EditorToolbar.vue        # 顶部工具栏：Open Folder / Reload from Disk
│   ├── EditorSidebar.vue        # 左侧树形导航：Schema > Table，支持折叠/展开/拖拽
│   ├── CommonConfigPanel.vue    # Common 配置编辑面板（common_used_fields、排序、default_config）
│   ├── TableEditor.vue          # 表编辑主面板，组合以下子组件
│   ├── FieldTable.vue           # 字段列表表格编辑
│   ├── IndexTable.vue           # 索引列表表格编辑
│   ├── AddFieldModal.vue        # 添加字段弹窗
│   ├── SqlPreview.vue           # SQL 建表语句实时预览（MySQL / PostgreSQL 标签切换）
│   └── InitialDataEditor.vue    # 初始数据编辑器（表格模式 / JSON 模式）
├── stores/
│   └── editor.ts                # Pinia Store：编辑器全局状态管理（表/字段/索引 CRUD、拖拽、文件读写）
├── types/
│   ├── schema.ts                # Schema 核心类型定义（Schema、Table、Field、Index 等）
│   └── global.d.ts              # 全局类型声明
└── utils/
    ├── file-helpers.ts          # 文件系统操作（File System Access API 封装）
    └── sql-generator/
        ├── shared.ts            # SQL 生成公共逻辑
        ├── mysql.ts             # MySQL 方言 SQL 生成
        └── postgresql.ts        # PostgreSQL 方言 SQL 生成
```

## 架构概览

### 数据流

```
本地文件夹 (common.json + schema/*.json)
        │ File System Access API
        ▼
  file-helpers.ts  ←→  Pinia Store (editor.ts)
        │                    │
        │                    ▼
        │          Vue Components (响应式渲染)
        │                    │
        ▼                    ▼
  自动保存到本地       SQL 生成器 (sql-generator/)
                           │
                           ▼
                      SQL 预览面板
```

### 核心设计

1. **单一 Store**：所有编辑器状态集中在 `stores/editor.ts`，组件通过 Pinia 读取/修改状态
2. **文件自动保存**：基于 File System Access API，在组件中编辑后直接通过 Store 同步写回本地文件
3. **双方言覆盖**：字段类型、索引配置在数据模型中区分 `mysql_override` 和 `pg_override`，SQL 生成器根据目标方言读取对应配置

## 脚本

```sh
pnpm dev           # 启动 Vite 开发服务器
pnpm build         # 并行：类型检查 + 生产构建
pnpm preview       # 预览生产构建
pnpm lint          # 并行：oxlint + eslint
pnpm format        # oxfmt 格式化 src/
pnpm type-check    # 单独运行 vue-tsc 类型检查
```

## 部署

- 通过 GitHub Actions 自动构建并部署到 GitHub Pages
- `base` 路径在 CI 环境中自动设为 `/{repo-name}/`，本地开发时为 `/`
- 纯前端应用，无后端，构建产物为静态文件
