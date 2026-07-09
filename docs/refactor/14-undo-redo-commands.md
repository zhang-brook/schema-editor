# 14 · undo/redo 命令模式 + 结构化 patch + 按需写文件

> 目标：当前架构每次重做/恢复都全量快照，且每次改动全量写盘。引入「命令模式 + 结构化补丁」：每次用户改动生成一个原子命令（含 forward/backward 数据），undo/redo 只应用/回滚该命令，并**只写受影响的 json 文件**，顺带解决全量保存问题。
> 依赖：统一路径层 `src/core/workspace/`、`[11-directory-restructure.md](./11-directory-restructure.md)`（按需写文件依赖每表独立 JSON）。

## 现状问题

- `editor.ts` 保存为全量：遍历所有 schema 写 `table.json` + 两方言 `output` SQL，initial-data 遍历全量写。
- 没有真正的 undo/redo 底层：当前若要实现 redo-undo，只能每次全量快照，内存与磁盘开销大、且无法定位「改了哪个文件」。

## 设计

1. **命令接口**（内存态）：
   ```ts
   interface Command {
     label: string
     // 应用：修改内存态（editor store 的 reactive 数据）
     apply(): void
     // 回滚：恢复原内存态
     revert(): void
     // 本命令影响的最小文件集合（用于按需写盘）
     affectedFiles(): { schema?: string; table?: string; kind: 'table' | 'initial-data' | 'common' | 'database' | 'sql' }[]
   }
   ```
   - `apply` / `revert` 操作内存态（与现有 `reactive` 数据交互），不直接碰 FS。
2. **命令管理器**（新模块，如 `src/core/history/`）：
   - `execute(cmd)`：调用 `cmd.apply()` → 推入 undo 栈、清空 redo 栈 → 触发「受影响文件」的按需写盘。
   - `undo()`：`cmd.revert()` → 移入 redo 栈 → 按需写盘。
   - `redo()`：重放 `cmd.apply()` → 按需写盘。
   - 通过 `watch` 防抖：用户连续键入等高频操作可合并为单命令（如「编辑字段名」整段操作一个命令）。
3. **按需写文件**：命令执行后，仅对 `affectedFiles()` 列出的文件调用 `src/core/workspace/paths.ts` 的路径解析 + 写盘；
   - SQL 生成：本次**先保持全量生成 SQL**（背景已确认「SQL 部分更新可后续」），但仅当 `affectedFiles` 含 `sql` 或全部保存时才写 `output/`。
   - common/database 仅在相关命令时写。
4. **与现有 auto-sync watcher 协同**：当前 `editor.ts` 用 `watch(schemas/commonConfig/initialDataMap)` 触发全量保存；引入命令模式后，保存由命令驱动，watcher 退化为「非命令来源的外部变更」（如 `reloadFromDisk`）才全量写，避免双写。保留 `_writeDepth` 防抖。

## 验收标准

- 增删字段/表、改注释、切 skip 等用户操作可 undo/redo，且内存态与磁盘文件一致。
- 单次用户改动只写受影响的 `table.json` / `initial-data.json`（通过 `affectedFiles`），不再全量写所有 schema。
- undo/redo 不破坏 `FileSystemObserver` 的防抖（`_writeDepth` / `_reloading`）。
- 高频连续编辑（如输入框打字）合并为单条 undo 记录，不会每键一步。
- 行为与重构前一致：保存触发的 SQL 输出内容与先前一致（本次 SQL 仍全量生成、按需写）。
- `pnpm build` 通过，原有代码风格保持。

## 原子提交拆分建议

1. `feat: 新增 src/core/history/command.ts 命令接口与 CommandManager`
2. `feat: editor.ts 关键用户操作改为经 CommandManager.execute（先覆盖增删字段）`
3. `refactor: 保存改为按需写（affectedFiles → workspace 路径层）`
4. `refactor: undo/redo 接入工具栏按钮`
5. `refactor: 收敛 auto-sync watcher，避免与命令写盘双写`
