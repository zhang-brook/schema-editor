# 索引列编辑器组件 + 结构版本系统

## Context

当前索引 `columns` 是 `string[]`（如 `["biz_type", "create_time DESC"]`），存在两个问题：
1. **SQL 生成 bug**：`create_time DESC` 整个被反引号包裹，排序方向在引号内
2. **UI 不友好**：纯文本输入框，无法直观配置排序列

用户希望做更彻底的改造：
- `columns` 改为结构化对象，支持排序列 + 按数据库方言覆盖
- 引入 `structVersion` 版本概念，实现自动升级和老版本拦截

## 方案概述

### 版本策略

| 版本 | 含义 |
|------|------|
| `"0.0"`（缺省） | 旧格式：`columns: string[]` |
| `"0.1"` | 新格式：`columns: IndexColumn[]` |

- `struct_version` 存储在 `common.json` 中
- 新版 editor 打开旧项目 → 自动后台升级（`string[]` → `IndexColumn[]`，版本写为 `"0.1"`）
- 旧版 editor 打开新项目 → alert 提示用户升级 editor，拒绝打开

### 数据模型

```ts
// 新增类型
interface IndexColumn {
  name: string
  sort_order?: 'ASC' | 'DESC'
  mysql?: IndexColumnDbOverride
  pgsql?: IndexColumnDbOverride
}

interface IndexColumnDbOverride {
  sort_order?: 'ASC' | 'DESC'
}

// Index.columns 改为 IndexColumn[]
// CommonConfig 新增 struct_version?: string
```

### 自动升级流程

1. 加载 `common.json` → 读取 `struct_version`
2. 若缺省或 `"0.0"` → 标记需要升级
3. 若 `"0.1"` → 当前版本，无操作
4. 若更高版本 → `alert('项目结构版本过高，请升级编辑器')`，终止加载
5. 若需升级：遍历所有 schema → 每个 index 的 `columns` 从 `string[]` 转为 `IndexColumn[]`
6. 设置 `struct_version = "0.1"` 到内存，自动保存持久化

### 组件 IndexColumnsEditor.vue

每行：列名输入 + 排序下拉 + 展开方言覆盖 + 删除按钮，底部添加列按钮

## 实施任务

### Task 1: 类型定义 — `src/types/schema.ts`
- 新增 `IndexColumn`、`IndexColumnDbOverride` 接口
- `Index.columns` 改为 `IndexColumn[]`
- `CommonConfig` 新增 `struct_version?: string`

### Task 2: 工具函数 — `src/utils/index-column-utils.ts`
- `parseLegacyColumn()` — 解析旧格式 `"col DESC"`
- `upgradeIndexColumns()` — 批量升级
- `splitColumnForSql(col, db)` — 供 SQL 生成器分离列名和排序

### Task 3: 版本管理 — `src/utils/version-upgrader.ts`
- `checkVersion()` — 版本检查与升级标记
- `upgradeSchemaData()` — 遍历升级所有 index.columns

### Task 4: Store 集成 — `src/stores/editor.ts`
- `openProject()` / `reloadFromDisk()` 集成版本检查和升级
- `addIndex()` / `indexColumnsText()` / `setIndexColumns()` 适配新格式
- `buildSchemaExportData()` 确保 IndexColumn 正确序列化

### Task 5: 组件 — `src/components/IndexColumnsEditor.vue`
- v-model 绑定 `IndexColumn[]`，每行含方言覆盖展开区

### Task 6: 修改 — `src/components/IndexTable.vue`
- columns 列替换为 `<IndexColumnsEditor>`

### Task 7-8: 修正 SQL 生成器
- mysql.ts / postgresql.ts 使用 `splitColumnForSql()`

### Task 9: i18n 文案（zh-CN / en / zh-TW）

## 验证

1. 打开旧格式项目 → 自动升级，`common.json` 出现 `struct_version: "0.1"`
2. 配置排序列含 ASC/DESC 和 per-db 覆盖 → SQL 预览正确
3. 重新加载 → 数据恢复正确
4. 手动改 `struct_version` 为 `"0.2"` → 提示版本过高并拒绝加载