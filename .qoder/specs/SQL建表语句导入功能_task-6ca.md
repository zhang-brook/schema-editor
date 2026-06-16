# SQL 建表语句导入功能

## Context

用户希望粘贴一段 SQL 建表语句（可能包含多个 CREATE TABLE、MySQL 和 PostgreSQL 两种方言），系统自动解析并转换为编辑器内部数据结构（Schema → Table → Field + Index），充分利用项目现有的统一类型系统。

## 架构设计

```
用户粘贴 SQL 文本
       │
       ▼
┌─────────────────────────────────────────────┐
│              ImportSqlModal.vue              │
│  粘贴 SQL → 自动解析(防抖) → 预览结果 → 确认导入 │
└──────┬──────────────────┬───────────────────┘
       │                  │
       ▼                  ▼
┌──────────────┐  ┌──────────────────────┐
│ sql-parser/  │  │  stores/editor.ts    │
│ ├─ tokenizer │  │  + showImportSqlModal│
│ ├─ parser    │  │  + parseImportSql()  │
│ ├─ type-map  │  │  + confirmImport()   │
│ └─ dialect   │  └──────────────────────┘
└──────────────┘
```

解析器为**纯函数**，不依赖 Node.js 或外部库，完全在浏览器端运行。

## 文件变更清单

### 新建文件 (5个)

| 文件 | 职责 |
|------|------|
| `src/utils/sql-parser/tokenizer.ts` | 通用 SQL 词法分析器（状态机，处理关键字/标识符/字符串/数字/注释/引号标识符） |
| `src/utils/sql-parser/create-table-parser.ts` | 递归下降解析器，识别 `CREATE TABLE (col type constraints, ...) OPTIONS` 结构 |
| `src/utils/sql-parser/type-mapper.ts` | SQL 原始类型 → 统一类型/原始字段类型的映射引擎（三级回退策略） |
| `src/utils/sql-parser/dialect-detector.ts` | 启发式方言自动检测器（计分制：MySQL/PG 特征权重累加） |
| `src/components/ImportSqlModal.vue` | 导入 SQL 的 Modal UI（文本框 + 方言选择 + 解析预览 + 导入目标选择） |

### 修改文件 (6个)

| 文件 | 修改内容 |
|------|---------|
| `src/stores/editor.ts` | 新增 import SQL state（showImportSqlModal, importSqlText, parsedTables 等）+ actions（parseImportSql, confirmImportSql）+ parsedTableToTable 转换函数 |
| `src/App.vue` | 引入 `<ImportSqlModal />` |
| `src/components/EditorToolbar.vue` | 添加「导入 SQL」按钮 |
| `src/i18n/locales/zh-CN.json` | 新增 importSqlModal 翻译段 |
| `src/i18n/locales/en.json` | 新增 importSqlModal 翻译段 |
| `src/i18n/locales/zh-TW.json` | 新增 importSqlModal 翻译段 |

## 实现任务

### Task 1: 实现 SQL 词法分析器 (tokenizer.ts)

- 状态机逐字符扫描，产出 Token 流
- Token 类型：KEYWORD, IDENTIFIER, BACKTICK_ID, DOUBLEQUOTE_ID, STRING, NUMBER, SYMBOL, COMMENT, EOF
- 每个 Token 携带 line/column 用于错误定位
- 正确处理转义：`''`、`""`、`` `` ``、`\'`
- 大小写不敏感的关键字匹配

### Task 2: 实现 CREATE TABLE 解析器 (create-table-parser.ts)

- 解析 `CREATE [OR REPLACE] [TEMPORARY] TABLE [IF NOT EXISTS] name (body) [options]`
- 支持 `schema.table` 格式的表名
- 列定义解析：name type[(length[,scale])] [constraints...]
- 列约束：NOT NULL, NULL, DEFAULT value, AUTO_INCREMENT, PRIMARY KEY, UNIQUE, COMMENT '...', GENERATED AS IDENTITY
- 表级约束：PRIMARY KEY(cols), UNIQUE [KEY], INDEX/KEY, FULLTEXT, CONSTRAINT name ...
- MySQL 表选项：ENGINE=, [DEFAULT] CHARSET/CHARACTER SET=, COLLATE=, AUTO_INCREMENT=, COMMENT=
- PostgreSQL SERIAL/BIGSERIAL 特殊处理
- 跳过无法解析的子句并记录 warning

### Task 3: 实现类型映射器 (type-mapper.ts)

**三级回退策略**：
- Level 1：精确匹配统一类型（比较类型名 + 可选长度/scale）
- Level 2：匹配统一类型但覆盖 SQL 中的具体长度/scale
- Level 3：无匹配时回退到原始 SQL 类型

特殊映射：
- `SERIAL` → Integer + not_null + field_length_disabled
- `TINYINT(1)` → Boolean
- `BOOLEAN` → Boolean（MySQL 中为 TINYINT(1) 别名）
- `DOUBLE PRECISION` → Double
- `ENUM(...)` → raw type ENUM

### Task 4: 实现方言检测器 (dialect-detector.ts)

计分制检测规则（正分→PostgreSQL，负分→MySQL）：
- `GENERATED AS IDENTITY` +3
- `SERIAL`/`BIGSERIAL` +3
- `` `backtick` `` 标识符 -2
- `ENGINE=` -3
- `AUTO_INCREMENT` -3
- `TINYINT` -3
- `ENUM`/`SET` -2
- 双引号标识符 + 无 ENGINE 子句 +2

### Task 5: Store 集成 (editor.ts)

- 新增 reactive state：showImportSqlModal, importSqlText, importSqlDialect, importSqlParsedTables, importSqlErrors, importSqlTargetMode, importSqlTargetSchemaIdx, importSqlNewSchemaName
- `parseImportSql()`：调用解析器 + 方言检测
- `confirmImportSql()`：转换 + 导入到目标 schema（新建或追加）
- `parsedTableToTable()`：ParsedTable → Table 转换（列映射、约束转索引、表选项转 mysql 配置）

### Task 6: 创建 ImportSqlModal.vue

- 使用项目现有 Modal 风格（参考 AddFieldModal.vue）
- 方言选择：自动检测 / MySQL / PostgreSQL 三个 radio
- 大文本框（textarea）用于粘贴 SQL，带防抖自动解析（500ms）
- 解析结果预览区：列出检测到的表、字段数、索引数
- 展开可查看每张表的字段详情（名称、类型、约束）
- 导入目标：新建 Schema（可自定义名称）或追加到现有 Schema
- 解析错误列表（warning 黄色 / error 红色，带行号）
- 确认导入按钮（无有效表时禁用）

### Task 7: UI 接入 + i18n

- `App.vue` 中引入 `<ImportSqlModal />`
- `EditorToolbar.vue` 中添加「导入 SQL」按钮
- zh-CN.json / en.json / zh-TW.json 添加 importSqlModal 翻译段
- 翻译 key 示例：`importSqlModal.title`, `.dialect`, `.sqlPlaceholder`, `.parsedTables`, `.target`, `.importBtn`

## 验证方式

1. 启动开发服务器 `pnpm dev`
2. 点击工具栏「导入 SQL」按钮
3. 粘贴以下测试 SQL：
```sql
CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```
4. 确认自动检测为 MySQL，解析出 1 张表 4 个字段
5. 确认字段类型正确映射：id→Integer, name→String(255), email→String(255), created_at→DateTime
6. 导入后检查编辑器侧边栏出现新 Schema/Table，打开查看字段配置
7. 再测试 PostgreSQL 方言：
```sql
CREATE TABLE "public"."products" (
  "id" SERIAL PRIMARY KEY,
  "name" VARCHAR(200) NOT NULL,
  "price" DECIMAL(10,2),
  "is_active" BOOLEAN DEFAULT TRUE
);
```
8. 确认类型映射：id→Integer, name→String(200), price→Decimal(10,2), is_active→Boolean
9. 测试多表粘贴、错误 SQL 的错误提示