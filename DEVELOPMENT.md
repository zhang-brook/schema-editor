# 开发指南

本文档面向参与 schema-editor 开发的成员，涵盖技术栈、项目结构、架构设计和质量保障体系。

## 技术栈

- **Vue 3** + **TypeScript** + **Vite**
- **Pinia** 状态管理
- **vue-i18n** 国际化（en / zh-CN / zh-TW）
- **File System Access API** — 直接读写用户选定的本地文件夹，改动经工作区会话按需落盘
- **Git 平台 REST API** — 浏览器直连 GitHub / Gitee / Gitea，把远端仓库的分支子目录挂载为工作区
- 纯前端运行，无需后端服务；另提供 Electron 桌面外壳（`app/desktop/`），复用同一份前端产物，把文件夹访问接到原生选择器与 Node 文件系统

## 项目结构

仓库为 pnpm workspace：`app/` 下是可直接运行的应用，`packages/` 下是应用之间共享的包，依赖统一在仓库根安装。

```
app/
├── web/                         # 前端应用（网页版与桌面版渲染层共用同一套代码）
│   ├── index.html               # 入口 HTML
│   ├── public/                  # 静态资源（favicon / logo）
│   ├── vite.config.ts           # 相对基址：产物可部署在任意路径下，也可被桌面外壳以 file:// 加载
│   └── src/
│       ├── App.vue                      # 根组件，整体布局框架（工具栏 + 侧边栏 + 编辑区）
│       ├── main.ts                      # 入口文件，挂载 Vue 应用 & Pinia & i18n
│       ├── assets/
│       │   └── style/                   # 按功能拆分的 .css（base / layout / table / modal / form 等），由各组件 <style scoped src> 引入
│       ├── components/
│       │   ├── EditorToolbar.vue        # 顶部工具栏：项目 / 编辑 / 帮助菜单、保存按钮、实时保存开关、撤改重做
│       │   ├── UpgradingOverlay.vue     # 旧版本项目升级遮罩
│       │   ├── ui/                      # 无业务语义的基础组件
│       │   │   ├── PageTabs.vue         # 下划线式页面级 tab
│       │   │   └── SegmentedSwitch.vue  # 连体按钮式切换（方言 / 模式等）
│       │   ├── common/                  # 跨页面复用的业务组件
│       │   │   └── PrePostSqlEditor.vue # 前置 / 后置 SQL 编辑（表 / Schema / 初始数据 / 全局共用）
│       │   ├── icon/                    # 图标组件
│       │   ├── modal/                   # 弹窗组件（AddFieldModal / ImportSqlModal / AboutModal / ConfirmModal / OpenGitRepoModal / CommitDialog）
│       │   ├── settings/                # 设置区：左侧 rail + 三个页面
│       │   │   ├── SettingsPanel.vue        # 外壳：SettingsRail + 三个页面组件
│       │   │   ├── SettingsRail.vue         # 页面切换列（项目设置 / 库结构设计 / 版本管理）
│       │   │   ├── ProjectConfigPage.vue    # 项目设置页（通用字段·统一类型 / 方言配置 / 大模型）
│       │   │   ├── StructureDesignPage.vue  # 库结构设计页（侧边树 + 拖拽分隔 + 编辑面板）
│       │   │   ├── VersionManagementPage.vue# 版本管理页（版本 / 迁移两个子 tab）
│       │   │   ├── VersionTimeline.vue      # 版本时间线（节点 + 迁移连线）
│       │   │   ├── EnvironmentPanel.vue     # 环境管理
│       │   │   ├── RenameAlignPanel.vue     # 改名识别的对齐配置
│       │   │   └── sections/                # 项目设置页内的各配置板块
│       │   │       ├── CommonUsedFieldsPanel.vue / UnifiedTypesPanel.vue
│       │   │       ├── LogicalDeletePanel.vue   # 逻辑删除配置（删除字段 / 未删除谓词 / MySQL 策略）
│       │   │       ├── DialectConfigPanel.vue / DdlOptionsPanel.vue / TypeCasePanel.vue
│       │   │       ├── GlobalPrePostSqlPanel.vue / AiGuidePanel.vue / ProjectInfoPanel.vue
│       │   │       └── database-defaults/   # 数据库默认配置（合体卡片 + 三方言子面板）
│       │   └── structure/               # 库结构设计相关组件
│       │       ├── EditorSidebar.vue        # 左侧树形导航：Schema > Table，支持折叠/展开/拖拽
│       │       ├── SchemaConfigPanel.vue    # Schema 配置编辑面板
│       │       ├── TableEditor.vue          # 表编辑主面板，组合以下子组件
│       │       ├── TableBasicInfo.vue       # 表基础信息编辑
│       │       ├── FieldTable.vue           # 字段列表表格编辑（FieldCommentInput 为备注单元格）
│       │       ├── IndexTable.vue           # 索引列表表格编辑（IndexColumnsEditor 为索引列编辑）
│       │       ├── SqlPreview.vue           # SQL 建表语句实时预览（方言切换）
│       │       └── InitialDataEditor.vue    # 初始数据编辑器（含 InitialDataSqlPreview）
│       ├── composables/
│       │   ├── useDropFolder.ts         # 拖拽文件夹打开的组合式函数
│       │   ├── useEscClose.ts           # Esc 关闭弹窗的组合式函数
│       │   ├── useConfirm.ts            # 全局弹窗队列（confirmDialog / chooseDialog 三选一 / alertDialog）
│       │   ├── useEnterConfirm.ts       # 弹窗回车确认
│       │   └── useEnabledDialect.ts     # 当前启用的方言
│       ├── i18n/
│       │   ├── index.ts                 # vue-i18n 初始化
│       │   ├── detection.ts             # 浏览器语言检测
│       │   └── locales/                 # en / zh-CN / zh-TW 语言包
│       ├── platform/
│       │   └── desktop-fsa.ts           # 桌面端 File System Access 模拟层（目录/文件句柄、FileSystemObserver、showDirectoryPicker）
│       ├── stores/                      # Pinia：主 store + 按职责拆分的 action 工厂
│       │   ├── editor.ts                # 主 store：持有状态，组合下列 action 并对组件暴露统一 API
│       │   ├── editor-action-utils.ts   # action 工厂共用工具（快照捕获、名称校验、数组增删移）
│       │   ├── editor-crud.ts           # 组合 schema / table / field / index 四个动作模块
│       │   ├── editor-schema-actions.ts # schema 增删改与排序
│       │   ├── editor-table-actions.ts  # table 增删改、基础信息与前后置 SQL
│       │   ├── editor-field-actions.ts  # 字段增删改、统一类型解析与方言覆盖
│       │   ├── editor-index-actions.ts  # 索引增删改与索引列
│       │   ├── editor-common-config.ts  # 公共配置（统一类型 / 常用字段 / 方言配置等）
│       │   ├── editor-initial-data.ts   # 初始数据编辑
│       │   ├── editor-import-sql.ts     # 导入 SQL 解析与落库
│       │   └── editor-version.ts        # 版本 / 迁移 / 环境
│       ├── types/
│       │   ├── settings.ts              # 设置区页面类型（SettingsTab）
│       │   └── global.d.ts              # 全局类型声明（浏览器 API 与桌面注入对象）
│       └── utils/
│           ├── constants.ts             # 全局常量
│           ├── build-info.ts            # 构建信息（版本号 / 构建时间）
│           └── column-drag-flag.ts      # 列拖拽进行中的全局标记
├── desktop/                     # 桌面外壳（Electron）：加载前端构建产物并桥接本地文件系统
│   ├── src/
│   │   ├── main.ts              # 主进程：创建窗口、注册 IPC、开发模式加载 Vite 服务
│   │   ├── preload.ts           # 通过 contextBridge 暴露 window.schemaEditorDesktop
│   │   └── fs-service.ts        # 基于 node:fs 的文件系统服务，只依赖已授权根目录（可脱离 Electron 测试）
│   ├── vite.config.mts          # 主进程 / preload 的 CJS 构建（两次单入口，preload 必须自包含）
│   └── electron-builder.yml     # Windows 打包配置（NSIS 安装包 + 免安装 exe）
└── packages/
    ├── core/                    # schema-editor-core：与 UI、与 Vue 运行时无关的领域核心，网页与桌面共用
    │   ├── package.json         # 源码直出（exports 指向 src/*.ts），宿主构建工具直接编译，无独立构建步骤
    │   └── src/
    │       ├── index.ts                 # 入口：转出领域类型；具体能力按子路径引用，如 schema-editor-core/utils/sql-generator
    │       ├── types/
    │       │   └── schema.ts            # Schema 核心类型定义（Schema、Table、Field、Index 等）
    │       ├── core/                    # 核心领域层
    │       │   ├── ids.ts               # 唯一 id 生成（仅版本 / 迁移等存储实体使用）
    │       │   ├── history/
    │       │   │   └── command.ts       # 命令模式 + 结构化 patch（undo/redo 底层）
    │       │   ├── workspace/           # 统一路径层与工作区读写
    │       │   │   ├── layout.ts        # 路径常量 + CURRENT_STRUCT_VERSION + 文件名友好化
    │       │   │   ├── handles.ts       # File System Access API 原语封装
    │       │   │   ├── paths.ts         # 业务路径解析（新旧结构兼容）
    │       │   │   ├── serialization.ts # 内存态 → 磁盘文档的序列化（common / schema / table）
    │       │   │   ├── project-documents.ts # 项目文档规划：由变更范围算出待写文件与派生 SQL
    │       │   │   ├── browser-workspace.ts # 批量写入、路径白名单校验与外部改动冲突检测
    │       │   │   ├── git/             # Git 远端工作区（地址解析 / 平台 API / 写入器 / 令牌）
    │       │   │   │   ├── url.ts       # 仓库地址 → provider + owner/repo + 分支 + 子目录
    │       │   │   │   ├── types.ts     # GitRepoInfo、GitRepoError 与错误码
    │       │   │   │   ├── providers.ts # GitHub / Gitee / Gitea 的读快照与提交实现
    │       │   │   │   ├── credentials.ts # 令牌存会话内存，勾选记住时按站点落本地
    │       │   │   │   └── workspace.ts # GitWorkspaceWriter：不支持自动保存，分支头变动即拒绝提交
    │       │   │   ├── save-coordinator.ts  # 串行保存队列：脏文件追踪 + 防抖 + 手动整批保存
    │       │   │   └── workspace-session.ts # 工作区会话：加载项目、声明变更、手动保存
    │       │   └── version/             # 版本与迁移
    │       │       ├── types.ts         # 版本 / 迁移脚本类型定义
    │       │       ├── storage.ts       # versions/<id>.json 读写
    │       │       ├── migration-storage.ts # migrations/<id>.json 读写
    │       │       ├── environment-storage.ts # 环境定义读写
    │       │       ├── diff.ts          # 结构 diff 引擎
    │       │       ├── identity.ts      # 改名识别与推断
    │       │       ├── matcher.ts       # 结构对象相似度匹配
    │       │       ├── chain.ts         # 版本链：父子关系时间线 + 缺失迁移标注
    │       │       ├── guards.ts        # 操作合法性校验
    │       │       └── migration-ddl.ts # 迁移脚本 → 变更 DDL（MySQL / PostgreSQL / SQLite）
    │       └── utils/
    │           ├── file-helpers.ts          # 旧结构 → 新结构的迁移写入入口，以及字段长度/默认值的输入解析
    │           ├── initial-data-io.ts       # 初始数据（行内结构）读写
    │           ├── dialect-resolver.ts      # 方言配置覆盖解析辅助
    │           ├── index-column-utils.ts    # 索引列解析与方言覆盖工具
    │           ├── field-utils.ts           # 字段属性读取工具
    │           ├── table-comment-utils.ts   # 表注释工具
    │           ├── logical-delete.ts        # 逻辑删除解析（项目级配置 + 索引级覆盖 → 各方言落地形式）
    │           ├── unified-types.ts         # 跨模块共用的统一类型
    │           ├── ai-guide/                # AI 结构指南 Markdown 生成
    │           ├── structure-migrations/    # 项目结构迁移链（v0.0 → v1.0，注册表驱动）
    │           ├── sql-generator/
    │           │   ├── shared.ts        # SQL 生成公共逻辑
    │           │   ├── mysql.ts         # MySQL 方言 SQL 生成
    │           │   ├── postgresql.ts    # PostgreSQL 方言 SQL 生成
    │           │   └── sqlite.ts        # SQLite 方言 SQL 生成
    │           └── sql-parser/
    │               ├── index.ts         # SQL 解析入口
    │               ├── tokenizer.ts     # SQL 词法分析
    │               ├── create-table-parser.ts # CREATE TABLE 语句解析
    │               ├── dialect-detector.ts  # 方言自动检测
    │               └── type-mapper.ts   # 字段类型映射
    └── bridge/                  # 桌面桥接协议：IPC 通道名与请求/响应负载（主进程 / preload / 渲染端共用）
```

仓库根存放各应用共用的工具与配置：TypeScript 工程引用、ESLint / oxlint / oxfmt 配置、`scripts/` 下的脚本、`docs/` 下的补充文档。

## 架构概览

领域逻辑（类型、SQL 生成与解析、工作区读写、结构升级、版本比较）在 `packages/core/src/`，以 `schema-editor-core/<子路径>` 引用；界面、Pinia store、i18n 与桌面端 File System Access 模拟层在 `app/web/src/`。包内不依赖 Vue，端侧差异由宿主在运行时注入。下文用裸模块名指代文件，`stores/`、`platform/`、`composables/` 前缀的在 `app/web/src/` 下，`core/`、`utils/`、`types/` 前缀的在 `packages/core/src/` 下。

### 数据流

```
本地工作目录 (common.json + current/ + versions/ + migrations/)
        │ File System Access API（schema-editor-core 的 core/workspace；桌面端由 platform/desktop-fsa 模拟为 IPC 调用）
        ▼
  workspace-session.ts  ←→  Pinia Store (editor.ts + 5 个 action 工厂)
   （加载 + 变更范围 + 手动保存）        │
        │                              ▼
        │                    Vue Components (响应式渲染)
        │                              │
        ▼                              ▼
  save-coordinator.ts            SQL 生成器 (sql-generator/)
   （脏文件追踪 + 防抖 + 整批写入）        │
        │  project-documents.ts         ▼
        ▼  （由变更范围算出待写文件）   SQL 预览面板
  browser-workspace.ts（逐文件写入 + 冲突检测）
```

工作目录可以换成分支上的子目录：`workspace/git/` 提供另一个写入器，接在 `save-coordinator.ts` 的同一位置，读快照走平台 API、写出即提交。

### 核心设计

1. **组合式 Store**：`stores/editor.ts` 持有状态并组合 5 个 action 工厂（crud / 公共配置 / 初始数据 / 导入 SQL / 版本；crud 内部再拆为 schema / table / field / index 四个模块），组件只面对单一 `useEditorStore()`
2. **命令模式 undo/redo + 按需落盘**：每次改动生成一个命令（apply / revert / affectedFiles）；命令执行后把受影响文件集合交给工作区会话，由 `project-documents.ts` 展开成真正需要写入的文档集合（含派生 SQL），`save-coordinator.ts` 防抖后只写内容确有变化的文件。写入按「项目文档」与「派生文件（output/ 下的 SQL、AI 指南）」两组分别开关，且派生写入依赖项目文档写入（勾选同步保存 SQL 会连带开启项目文件保存），避免 `output/` 领先于 JSON；未启用自动写入的组保持待保存状态，由「保存」按钮整批写入，并有未保存提醒与离开保护
3. **方言覆盖解析**：字段类型、索引等属性统一经 `resolveDialectOverride` 读取（方言值 → 顶层同名属性 → 默认值），生成 MySQL / PostgreSQL / SQLite 三种 DDL
4. **写入器可替换**：本地文件夹与 Git 分支共用同一个协调器接口。Git 写入器声明不支持自动保存，协调器据此关掉两组开关、把改动留在内存，「保存」升级为「提交」：先按手动保存的口径算出待提交文件供弹窗预览，确认后一次 commit，内容未变化的文件不会重复提交；提交前比对分支头，与加载时的快照不一致就拒绝，避免盖掉他人推送

## 脚本

```sh
pnpm dev           # 启动 Vite 开发服务器
pnpm build         # app/web：并行执行类型检查 + 生产构建
pnpm preview       # 预览生产构建
pnpm test:unit     # Vitest 单元测试（覆盖 packages/core、app/web 与 app/desktop）
pnpm type-check    # 全仓类型检查（根配置 + packages/core + app/web + app/desktop）
pnpm lint          # 串行：oxlint → eslint（覆盖整个仓库）
pnpm format        # oxfmt 格式化 app/web/src
pnpm changelog     # 生成 CHANGELOG（版本号取自 app/web/package.json）
```

桌面端：

```sh
pnpm desktop:dev          # 开发模式：Vite 开发服务器 + Electron 窗口
pnpm desktop:start        # 仅启动 Electron 窗口
pnpm desktop:build        # 构建渲染层（app/desktop/renderer）与主进程 / preload
pnpm desktop:dist         # 构建并打包 Windows 安装包与免安装 exe（app/desktop/release）
```

## 部署

- 通过 GitHub Actions 自动构建并部署到 GitHub Pages（产物为 `app/web/dist`）
- `base` 固定为相对路径 `./`，产物可部署在任意子路径下，也可被桌面外壳以 `file://` 直接加载
- 纯前端应用，无后端，构建产物为静态文件
- Windows 安装包由 `pnpm desktop:dist` 本地打包，未配置代码签名（安装时可能出现 SmartScreen 提示）
