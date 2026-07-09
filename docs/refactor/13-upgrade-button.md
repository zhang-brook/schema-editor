# 13 · 手动「升级项目结构」按钮

> 目标：核心重构后目录/数据结构发生破坏性变化（每表独立 JSON、initial-data 行内化、struct_version 2.0）。为避免自动改盘造成的不可预期损失，**提供显式按钮**，由用户手动触发从旧结构迁移到新结构。
> 依赖：统一路径层 `src/core/workspace/`、`[11-directory-restructure.md](./11-directory-restructure.md)`、`[12-initial-data-inline.md](./12-initial-data-inline.md)`。

## 背景

旧结构（重构前）：
- 根 `common.json`（含全部 common_config）
- `schemas/<schema>.json`（每 schema 一个文件，含其下所有表）
- `initial-data/<schema>/<table>.json`（平行数组结构）
- `output/<dialect>/<schema>.sql`

新结构见 [`11`](./11-directory-restructure.md) / [`12`](./12-initial-data-inline.md)。

决策（已确认）：**不自动改盘**，由用户在界面显式触发「升级项目结构」。

## 目标

1. `editor.ts` 打开项目时检测 `struct_version`：
   - 若 `< 2.0` 且目录为新结构不存在 → 提示「当前项目为旧结构，可升级」。
   - 提供「升级项目结构」按钮（工具栏/侧栏）。
2. 点击后执行一次性迁移：
   - 读取旧 `common.json` / `schemas/*.json` / `initial-data/*`，经升级器转为新内存态。
   - 写入新结构（`common.json` + `current/database.json` + 各 `table.json` + 各 `initial-data.json`）。
   - 旧文件保留（不删除），首次数次迁移给出一次提示，避免误覆盖。
3. 迁移完成后，`FileSystemObserver` 正常接管新结构。
4. 未升级前，若用户坚持用旧结构，可继续以旧结构打开（兼容读取保留）。

## 验收标准

- 旧结构项目打开时显示升级提示，点击按钮后磁盘变为新结构且数据完整（表、字段、索引、初始数据、注释、跳过、pre/post_sql 均不丢）。
- 升级后重新打开为「新结构项目」，无再次升级提示。
- 升级过程不破坏旧文件（保留原文件，便于回退）。
- 未升级时旧结构可读可编辑（兼容路径经 `src/core/workspace/paths.ts` 解析）。
- `pnpm build` 通过，界面功能正常。

## 原子提交拆分建议

1. `feat: editor.ts 检测旧结构并显示升级提示`
2. `feat: 实现 migrateOldToNewStructure 迁移函数（读写旧→写新）`
3. `feat: 工具栏/侧栏接入「升级项目结构」按钮`
4. `test: 迁移函数 Vitest 单测（内存态转换 + 路径映射，不接 jsdom）`
