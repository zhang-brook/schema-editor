# 背景与公共基础

> 本文件沉淀跨步骤的公共知识。各步骤文档通过相对链接引用本文对应章节，避免重复描述。

## 1. 分支与提交流程

- 第一批（噪声消除）已在 `refactor/modularize-stores` 分支完成并合并到 `main`。
- **核心重构（本批）** 在新分支 **`refactor/core-restructure`** 上进行：
  ```bash
  git checkout -b refactor/core-restructure
  ```
- **原子提交原则**：每个独立改动单独提交，单次提交只解决一个问题。
- **提交信息规范**：
  - 修复类：`fix: <简明描述>`
  - 功能/重构类：`feat: <简明描述>`
  - 禁止 `step1 xxx` / `step2 xxx` 式描述。
- **可运行约束**：每次提交前必须 `pnpm build`（或至少 `vue-tsc` 类型检查通过），不提交编译报错的版本。

## 2. 代码风格约定（保持不变）

重构过程中**必须保留原有代码风格**，包括但不限于：

- `.map` / `.filter` 等链式调用的换行习惯（每个回调换行）。
- 注释的位置与措辞风格。
- **逻辑语义分组**：同一语义的若干行放在一起，不同语义之间保留一个空行。
- 模块内部类型与实现混放是既有设计策略（便于就近查找），仅把多模块共用的类型抽到更高层级。

## 3. 现有项目架构

- 技术栈：Vue 3.5 + TypeScript + Vite + Pinia + vue-i18n；纯前端，基于 File System Access API 读写本地工作目录。
- 关键目录（核心重构前状态）：
  - `src/stores/editor.ts` —— 单一核心 store（体量较大）。当前所有状态（commonConfig / schemas / initialDataMap / handles）与全量保存逻辑集中于此。
  - `src/utils/version-upgrader.ts` —— 运行时数据结构升级器，当前 `CURRENT_STRUCT_VERSION = '0.4'`。
  - `src/utils/sql-generator/` —— SQL 生成器（`shared.ts` / `mysql.ts` / `postgresql.ts`）。
  - `src/utils/index-column-utils.ts` —— 索引列解析与方言覆盖工具。
  - `src/utils/file-helpers.ts` —— 目录读写（common.json / schemas/ / initial-data/ / output/ 路径散落于此）。
  - `src/composables/useDropFolder.ts` —— 拖拽文件夹打开，调用 `store.openProjectFromHandle`。
  - `src/assets/style/` —— 14 个按功能拆分的全局 `.css`，由 `index.css` 汇总 `@import`，在 `main.ts` 引入。
- **磁盘变更检测**：`editor.ts` 使用 `FileSystemObserver` 监听根目录（`reloadFromDisk`），配合 `_writeDepth` / `_reloading` 防抖，避免自身写盘触发重读。
- **当前保存流程（全量）**：`saveAll` / `syncSqlToOutput` 遍历所有 `schemas`，对每个 schema 调 `writeSchemaToHandle`，并对两个方言写 `output/<dialect>/<schema>.sql`；initial-data 遍历 `initialDataMap` 写 `initial-data/<schema>/<table>.json`。

## 4. 目录与数据模型（核心重构目标态）

> 目录结构重构（每表独立 JSON + current/ 布局）已随统一路径层 `src/core/workspace/` 与结构迁移链 `v0.4→v1.0` 一并落地（原方案文档 `11-directory-restructure.md` 已归档删除）。统一路径层已落地，目录/句柄解析均经此模块。

新工作目录布局（工作目录可能被 git 管理，基线用普通文件以保留完整历史）：

```
your-schema-folder/
├── common.json                       # 与基线版本无关的配置（default_config / unified_types / common_used_fields 等）
├── current/                          # 当前正在编辑的基线（固定名）
│   ├── database.json                 # schema order 排序 + 原 common_config 中与基线相关的配置
│   └── schemas/
│       └── <schema_name>/            # 文件名友好的模式名
│           ├── schema.json           # schema 原始名称（及 table 排序）
│           └── <table_name>/         # 文件名友好的表名
│               ├── table.json        # 表配置项（字段定义、索引、pre/post_sql 等）
│               └── initial-data.json # 行内化的初始数据
├── baselines/                        # 历史基线快照（结构同 current/）
│   ├── 2026-07-09T16-32-v0.4.json
│   └── 2026-08-01T10-00-v0.4.json
└── migrations/                       # 用户维护的迁移脚本（自定义 SQL + 步骤）
    └── <migration-id>.json
```

- **initial-data 行内结构**：将 `rows / row_comments / field_comments / skip_rows` 四个平行数组合并为行内对象数组：
  ```ts
  rows: Array<{
    data: Record<string, any>
    field_comments?: Record<string, string>   // 仅该项有注释时存在
    is_skip?: boolean                          // 仅跳过时存在
    row_comment?: string                       // 可选
  }>
  ```
- **版本**：核心重构时 `struct_version` 从 `'0.4'` 提升到 `'1.0'`（见 [`12-initial-data-inline.md`](./12-initial-data-inline.md)）。

## 5. 方言解析约定

现状：针对数据库方言的配置覆盖，采用「在配置对象上单独加 `mysql:{}` / `postgresql:{}` 属性」的方式，读取处散落形如：

```ts
const x = obj.mysql?.attr ?? obj.attr ?? 'default'
```

已引入统一方言解析辅助函数（如 `resolveDialectOverride(obj, dialect, key, fallback)`），把所有散落读取收敛到一处。新增代码**必须**走辅助函数，不再新增散落读取。

> 注：`pgsql` 是历史遗留字段名（0.3→0.4 升级时改为 `postgresql`），旧字段访问已收敛到 `readLegacyField()` 辅助函数内。

## 6. 版本升级机制

- 数据结构版本存于 `common.json` 的 `struct_version`。
- 打开项目时 `version-upgrader.ts` 按版本逐步升级到 `CURRENT_STRUCT_VERSION`。
- 历史兼容：`pgsql` → `postgresql` 字段重命名，旧字段访问已收敛到 `readLegacyField()`。
- 核心重构新增「**手动升级项目结构**」流程：旧目录结构不自动改盘，打开旧结构项目时弹窗确认，由用户显式触发迁移到新目录结构（迁移链见 `src/utils/structure-migrations/`）。

## 7. 文档约定

- 过时且与代码明显脱节的文档可归档或删除；仍能帮助未来维护的文档（DEVELOPMENT.md / README.md）更新为最新目录结构。
- 每个步骤文档至少包含「目标」与「验收标准」两节。

## 8. 核心重构关键决策（已与用户确认）

1. **范围**：本次一次性产出核心重构全套文档（目录 / initial-data / 统一路径层 / 手动升级按钮 / undo-redo / 基线+migrations 设计），代码落地仍按原子提交分批。
2. **field_id**：本次**暂不引入**，留到基线 diff 阶段再加（rename 跟踪待 field_id 落地后实现）。
3. **undo/redo**：采用「命令模式 + 结构化 patch」，undo/redo 只改受影响文件，顺带解决全量保存问题。
4. **统一路径层**：新增 `src/core/workspace/`（为后续基线/迁移预留独立模块）集中定义路径与句柄获取。
5. **旧数据迁移**：提供显式「升级项目结构」按钮，用户手动触发迁移，不自动改盘。
6. **initial-data 页面导入 JSON**：本次只做结构行内化 + 升级器兼容，页面导入入口单列后续文档。
7. **基线 / migrations**：本次只出设计文档，实现待 field_id 落地后。
