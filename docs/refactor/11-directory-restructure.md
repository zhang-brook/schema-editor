# 11 · 目录结构重构（每表独立 JSON + current/baselines/migrations）

> 目标：将当前「所有表存于 `schemas/*.json` + `initial-data/` 平行目录」改为每表独立 JSON，并引入 `current/`（当前基线）、`baselines/`（历史基线）、`migrations/`（用户迁移脚本）的目录布局。
> 依赖：已落地的统一路径层 `src/core/workspace/`（见 [`00-background.md`](./00-background.md) 第 4 节）。

## 目标态目录布局

```
your-schema-folder/
├── common.json                       # 与基线版本无关的配置（default_config / unified_types / common_used_fields 等）
├── current/                          # 当前正在编辑的基线（固定名）
│   ├── database.json                 # schema order 排序 + 原 common_config 中与基线相关的配置
│   └── schemas/
│       └── <schema_name>/            # 文件名友好的模式名（sanitizeName）
│           ├── schema.json           # schema 原始名称（及 table 排序）
│           └── <table_name>/         # 文件名友好的表名
│               ├── table.json        # 表配置项（字段定义、索引、pre/post_sql 等）
│               └── initial-data.json # 行内化的初始数据（见 12）
├── baselines/                        # 历史基线快照（结构同 current/）
│   ├── 2026-07-09T16-32-v0.4.json
│   └── 2026-08-01T10-00-v0.4.json
└── migrations/                       # 用户维护的迁移脚本（自定义 SQL + 步骤）
    └── <migration-id>.json
```

## 关键设计点

1. **基线用普通文件**：工作目录可能被 git 管理，基线采用普通 json 文件名（含时间戳/版本），以保留完整变更历史。
2. **统一路径层**：所有目录拼接、句柄获取经 `src/core/workspace/paths.ts`，不在本步骤内重散落。
3. **`common.json` 拆分**：原 `common_config` 中与「基线版本」相关的配置（如 `schema_order`、按基线可能不同的项）移入 `current/database.json`；与基线无关的（default_config / unified_types / common_used_fields）保留在根 `common.json`。
4. **每表独立 JSON**：原 `schemas/<schema>.json`（含该 schema 下所有 tables）拆为：
   - `current/schemas/<schema>/schema.json`：记录 schema 原始名称 + table 排序数组。
   - `current/schemas/<schema>/<table>/table.json`：单表定义。
   - `current/schemas/<schema>/<table>/initial-data.json`：行内化初始数据（见 12）。
5. **磁盘变更检测兼容**：`FileSystemObserver` 监听根目录的逻辑需适配新结构（`reloadFromDisk` 改为遍历 `current/schemas/`）；`useDropFolder.ts` 调用入口不变。
6. **struct_version**：本步骤配合 [`12-initial-data-inline.md`](./12-initial-data-inline.md) 将 `CURRENT_STRUCT_VERSION` 升至 `'2.0'`。

## 验收标准

- 打开新结构项目时，`editor.ts` 能从 `current/database.json` 读 schema 排序、从各 `table.json` 读表定义、从各 `initial-data.json` 读初始数据，内存态与重构前一致。
- 保存时按新结构写盘：`common.json` / `current/database.json` / 各 `table.json` / 各 `initial-data.json`，不再写旧的 `schemas/*.json` 与 `initial-data/` 平行目录。
- `FileSystemObserver` 的 `reloadFromDisk` 适配新结构，自身写盘不误触发重读（保留 `_writeDepth` / `_reloading` 防抖）。
- 拖拽打开（`useDropFolder.ts`）仍正常工作。
- 旧结构读取兼容由 [`13-upgrade-button.md`](./13-upgrade-button.md) 单独负责，本步骤不自动改旧盘。
- `pnpm build` 通过，界面功能行为一致。

## 原子提交拆分建议

1. `feat: workspace 路径层支持 current/database.json 与每表目录解析`
2. `feat: editor.ts 打开流程改为遍历 current/schemas 读取 table.json`
3. `feat: editor.ts 保存流程改为按每表目录写 table.json + database.json`
4. `refactor: reloadFromDisk 与 FileSystemObserver 适配新目录结构`
5. `refactor: useDropFolder 调用链路适配（如涉及）`
