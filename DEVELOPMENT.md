# 开发指南

本文档面向参与 schema-editor 开发的成员，涵盖技术栈、项目结构、架构设计和质量保障体系。

## 技术栈

- **Vue 3** + **TypeScript** + **Vite**
- **Pinia** 状态管理
- **vue-i18n** 国际化（en / zh-CN / zh-TW）
- **File System Access API** — 打开本地文件夹，编辑内容实时同步保存
- 纯前端运行，无需后端服务

## 项目结构

```
src/
├── App.vue                      # 根组件，整体布局框架（工具栏 + 侧边栏 + 编辑区）
├── main.ts                      # 入口文件，挂载 Vue 应用 & Pinia & i18n
├── assets/
│   └── style/                   # 按功能拆分的 .css（base / layout / table / modal / form 等），由各组件 <style scoped src> 引入
├── components/
│   ├── EditorToolbar.vue        # 顶部工具栏：Open Folder / Reload from Disk / Undo / Redo
│   ├── UpgradingOverlay.vue     # 旧版本项目升级遮罩
│   ├── ui/                      # 无业务语义的基础组件
│   │   ├── PageTabs.vue         # 下划线式页面级 tab
│   │   └── SegmentedSwitch.vue  # 连体按钮式切换（方言 / 模式等）
│   ├── common/                  # 跨页面复用的业务组件
│   │   └── PrePostSqlEditor.vue # 前置 / 后置 SQL 编辑（表 / Schema / 初始数据 / 全局共用）
│   ├── icon/                    # 图标组件
│   ├── modal/                   # 弹窗组件（AddFieldModal / ImportSqlModal / AboutModal / ConfirmModal）
│   ├── settings/                # 设置区：左侧 rail + 三个页面
│   │   ├── SettingsPanel.vue        # 外壳：SettingsRail + 三个页面组件
│   │   ├── SettingsRail.vue         # 页面切换列（项目设置 / 库结构设计 / 版本管理）
│   │   ├── ProjectConfigPage.vue    # 项目设置页（通用字段·统一类型 / 方言配置 / 大模型）
│   │   ├── StructureDesignPage.vue  # 库结构设计页（侧边树 + 拖拽分隔 + 编辑面板）
│   │   ├── VersionManagementPage.vue# 版本管理页（版本 / 迁移两个子 tab）
│   │   ├── VersionTimeline.vue      # 版本时间线（节点 + 迁移连线）
│   │   ├── EnvironmentPanel.vue     # 环境管理
│   │   ├── RenameAlignPanel.vue     # 改名识别的对齐配置
│   │   └── sections/                # 项目设置页内的各配置板块
│   │       ├── CommonUsedFieldsPanel.vue / UnifiedTypesPanel.vue
│   │       ├── DialectConfigPanel.vue / DdlOptionsPanel.vue / TypeCasePanel.vue
│   │       ├── GlobalPrePostSqlPanel.vue / AiGuidePanel.vue / ProjectInfoPanel.vue
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
│   ├── useEscClose.ts           # Esc 关闭弹窗的组合式函数
│   ├── useConfirm.ts            # 全局确认 / 提示弹窗队列（confirmDialog / alertDialog）
│   ├── useEnterConfirm.ts       # 弹窗回车确认
│   └── useEnabledDialect.ts     # 当前启用的方言
├── core/                        # 与 UI 无关的核心领域层
│   ├── ids.ts                   # 唯一 id 生成（仅版本 / 迁移等存储实体使用）
│   ├── history/
│   │   └── command.ts           # 命令模式 + 结构化 patch（undo/redo 底层）
│   ├── workspace/               # 统一路径层（路径单一事实来源）
│   │   ├── layout.ts            # 路径常量 + CURRENT_STRUCT_VERSION + 文件名友好化
│   │   ├── handles.ts           # File System Access API 原语封装
│   │   └── paths.ts             # 业务路径解析（新旧结构兼容）
│   └── version/                 # 版本与迁移
│       ├── types.ts             # 版本 / 迁移脚本类型定义
│       ├── storage.ts           # versions/<id>.json 读写
│       ├── migration-storage.ts # migrations/<id>.json 读写
│       ├── environment-storage.ts # 环境定义读写
│       ├── diff.ts              # 结构 diff 引擎
│       ├── identity.ts          # 改名识别与推断
│       ├── matcher.ts           # 结构对象相似度匹配
│       ├── chain.ts             # 版本链：父子关系时间线 + 缺失迁移标注
│       ├── guards.ts            # 操作合法性校验
│       └── migration-ddl.ts     # 迁移脚本 → 变更 DDL（MySQL / PostgreSQL / SQLite）
├── i18n/
│   ├── index.ts                 # vue-i18n 初始化
│   ├── detection.ts             # 浏览器语言检测
│   └── locales/                 # en / zh-CN / zh-TW 语言包
├── stores/                      # Pinia：主 store + 按职责拆分的 action 工厂
│   ├── editor.ts                # 主 store：持有状态，组合下列 action 并对组件暴露统一 API
│   ├── editor-crud.ts           # schema / table / field / index 增删改与拖拽
│   ├── editor-common-config.ts  # 公共配置（统一类型 / 常用字段 / 方言配置等）
│   ├── editor-initial-data.ts   # 初始数据编辑
│   ├── editor-import-sql.ts     # 导入 SQL 解析与落库
│   └── editor-version.ts        # 版本 / 迁移 / 环境
├── types/
│   ├── schema.ts                # Schema 核心类型定义（Schema、Table、Field、Index 等）
│   ├── settings.ts              # 设置区页面类型（SettingsTab）
│   └── global.d.ts              # 全局类型声明
└── utils/
    ├── constants.ts             # 全局常量
    ├── file-helpers.ts          # 项目读写（新旧结构），基于 core/workspace
    ├── initial-data-io.ts       # 初始数据（行内结构）读写
    ├── dialect-resolver.ts      # 方言配置覆盖解析辅助
    ├── index-column-utils.ts    # 索引列解析与方言覆盖工具
    ├── unified-types.ts         # 跨模块共用的统一类型
    ├── build-info.ts            # 构建信息（版本号 / 构建时间）
    ├── ai-guide/                # AI 结构指南 Markdown 生成
    ├── structure-migrations/    # 项目结构迁移链（v0.0 → v1.0，注册表驱动）
    ├── sql-generator/
    │   ├── shared.ts            # SQL 生成公共逻辑
    │   ├── mysql.ts             # MySQL 方言 SQL 生成
    │   ├── postgresql.ts        # PostgreSQL 方言 SQL 生成
    │   └── sqlite.ts            # SQLite 方言 SQL 生成
    └── sql-parser/
        ├── index.ts             # SQL 解析入口
        ├── tokenizer.ts         # SQL 词法分析
        ├── create-table-parser.ts # CREATE TABLE 语句解析
        ├── dialect-detector.ts  # 方言自动检测
        └── type-mapper.ts       # 字段类型映射
```

## 架构概览

### 数据流

```
本地工作目录 (common.json + current/ + versions/ + migrations/)
        │ File System Access API（core/workspace）
        ▼
  file-helpers.ts  ←→  Pinia Store (editor.ts + 5 个 action 工厂)
        │                    │
        │                    ▼
        │          Vue Components (响应式渲染)
        │                    │
        ▼                    ▼
  按需写回受影响文件    SQL 生成器 (sql-generator/)
                           │
                           ▼
                      SQL 预览面板
```

### 核心设计

1. **组合式 Store**：`stores/editor.ts` 持有状态并组合 5 个 action 工厂（crud / 公共配置 / 初始数据 / 导入 SQL / 版本），组件只面对单一 `useEditorStore()`
2. **命令模式 undo/redo + 按需写盘**：每次改动生成一个命令（apply / revert / affectedFiles），撤销只回滚该命令并只写回受影响的 JSON 文件
3. **方言覆盖解析**：字段类型、索引等属性统一经 `resolveDialectOverride` 读取（方言值 → 顶层同名属性 → 默认值），生成 MySQL / PostgreSQL / SQLite 三种 DDL

## 脚本

```sh
pnpm dev           # 启动 Vite 开发服务器
pnpm build         # 并行：类型检查 + 生产构建
pnpm preview       # 预览生产构建
pnpm test:unit     # Vitest 单元测试
pnpm lint          # 串行：oxlint → eslint
pnpm format        # oxfmt 格式化 src/
pnpm type-check    # 单独运行 vue-tsc 类型检查
pnpm changelog     # 生成 CHANGELOG
```

## 部署

- 通过 GitHub Actions 自动构建并部署到 GitHub Pages
- `base` 路径在 CI 环境中自动设为 `/{repo-name}/`，本地开发时为 `/`
- 纯前端应用，无后端，构建产物为静态文件
