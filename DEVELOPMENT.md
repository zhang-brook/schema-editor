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
├── main.ts                      # 入口文件，挂载 Vue 应用 & Pinia，引入全局样式
├── assets/
│   └── style/                   # 按功能拆分的全局 .css（base / layout / table / modal / form 等），由 main.ts 引入
├── components/
│   ├── EditorToolbar.vue        # 顶部工具栏：Open Folder / Reload from Disk
│   ├── UpgradingOverlay.vue     # 旧版本项目升级遮罩
│   ├── ui/                      # 无业务语义的基础组件
│   │   ├── PageTabs.vue         # 下划线式页面级 tab
│   │   └── SegmentedSwitch.vue  # 连体按钮式切换（方言 / 模式等）
│   ├── common/                  # 跨页面复用的业务组件
│   │   └── PrePostSqlEditor.vue # 前置 / 后置 SQL 编辑（表 / Schema / 初始数据 / 全局共用）
│   ├── icon/                    # 图标组件
│   ├── modal/                   # 弹窗组件（AddFieldModal / ImportSqlModal / AboutModal）
│   ├── settings/                # 设置区：左侧 rail + 三个页面
│   │   ├── SettingsPanel.vue        # 外壳：SettingsRail + 三个页面组件
│   │   ├── SettingsRail.vue         # 页面切换列（项目设置 / 库结构设计 / 版本管理）
│   │   ├── ProjectConfigPage.vue    # 项目设置页（通用字段·统一类型 / 方言配置 / 大模型）
│   │   ├── StructureDesignPage.vue  # 库结构设计页（侧边树 + 拖拽分隔 + 编辑面板）
│   │   ├── VersionManagementPage.vue# 版本管理页（版本 / 迁移两个子 tab）
│   │   └── sections/                # 项目设置页内的各配置板块
│   │       ├── CommonUsedFieldsPanel.vue / UnifiedTypesPanel.vue
│   │       ├── DialectConfigPanel.vue / DdlOptionsPanel.vue / TypeCasePanel.vue
│   │       ├── GlobalPrePostSqlPanel.vue / AiGuidePanel.vue
│   │       └── database-defaults/   # 数据库默认配置（合体卡片 + 三方言子面板）
│   └── structure/               # 库结构设计相关组件
│       ├── EditorSidebar.vue        # 左侧树形导航：Schema > Table，支持折叠/展开/拖拽
│       ├── SchemaConfigPanel.vue    # Schema 配置编辑面板
│       ├── TableEditor.vue          # 表编辑主面板，组合以下子组件
│       ├── TableBasicInfo.vue       # 表基础信息编辑
│       ├── FieldTable.vue           # 字段列表表格编辑（FieldCommentInput 为备注单元格）
│       ├── IndexTable.vue           # 索引列表表格编辑（IndexColumnsEditor 为索引列编辑）
│       ├── SqlPreview.vue           # SQL 建表语句实时预览（方言切换）
│       └── InitialDataEditor.vue    # 初始数据编辑器（含 InitialDataSqlPreview）
├── composables/
│   ├── useDropFolder.ts         # 拖拽文件夹打开的组合式函数
│   └── useEscClose.ts           # Esc 关闭弹窗的组合式函数
├── i18n/
│   ├── index.ts                 # vue-i18n 初始化
│   ├── detection.ts             # 浏览器语言检测
│   └── locales/                 # en / zh-CN / zh-TW 语言包
├── stores/
│   └── editor.ts                # Pinia Store：编辑器全局状态管理（表/字段/索引 CRUD、拖拽、文件读写）
├── types/
│   ├── schema.ts                # Schema 核心类型定义（Schema、Table、Field、Index 等）
│   ├── settings.ts              # 设置区页面类型（SettingsTab）
│   └── global.d.ts              # 全局类型声明
└── utils/
    ├── constants.ts             # 全局常量
    ├── file-helpers.ts          # 文件系统操作（File System Access API 封装）
    ├── dialect-resolver.ts      # 方言配置覆盖解析辅助
    ├── index-column-utils.ts    # 索引列解析与方言覆盖工具
    ├── unified-types.ts         # 跨模块共用的统一类型
    ├── version-upgrader.ts      # 运行时数据结构升级器（struct_version）
    ├── sql-generator/
    │   ├── shared.ts            # SQL 生成公共逻辑
    │   ├── mysql.ts             # MySQL 方言 SQL 生成
    │   └── postgresql.ts        # PostgreSQL 方言 SQL 生成
    └── sql-parser/
        ├── index.ts            # SQL 解析入口
        ├── tokenizer.ts        # SQL 词法分析
        ├── create-table-parser.ts # CREATE TABLE 语句解析
        ├── dialect-detector.ts # 方言自动检测
        └── type-mapper.ts      # 字段类型映射
```

## 架构概览

### 数据流

```
本地文件夹 (common.json + schemas/*.json + initial-data/<schema>/<table>.json)
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
