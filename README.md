# schema-editor - 数据库 Schema JSON 可视化编辑器

[GitHub](https://github.com/coder-xiaomo/schema-editor) · [在线预览](https://coder-xiaomo.github.io/schema-editor/)

数据库 Schema 可视化编辑器 —— 通过图形界面编辑 JSON 格式的 Schema 定义，实时预览 MySQL / PostgreSQL 建表语句，并将结果导出为 JSON 或 SQL 文件。

## 功能

- **可视化编辑**：树形导航（Schema > Table），直观管理多 Schema 下的表结构
- **方言支持**：字段类型、索引配置均支持 MySQL / PostgreSQL 差异化覆盖
- **字段管理**：表格化编辑字段属性，支持增删改查、注释开关、拖拽排序
- **索引管理**：定义主键、唯一索引、普通索引，含方言覆盖配置
- **SQL 实时预览**：编辑时实时预览当前表的建表语句及初始数据 INSERT 语句
- **初始数据编辑**：支持表格模式 / JSON 模式编辑初始数据，自动保存为 `initial-data/<schema>/<table>.json`
- **公共配置**：编辑 `common.json` 中的公共字段引用（`common_used_fields`）和默认配置
- **文件自动保存**：通过 File System Access API 打开本地文件夹，编辑内容实时同步保存

## 快速开始

```sh
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 构建生产版本
pnpm build
```

## 使用说明

1. **打开文件夹**：点击顶部「Open Folder」按钮，选择包含 `common.json` 和 schema JSON 文件的文件夹
2. **导航**：左侧树形面板展开 Schema 查看表列表，点击表名切换编辑目标
3. **编辑**：右侧面板可编辑表属性、字段、索引，切换方言标签查看不同数据库的 SQL 预览
4. **初始数据**：展开「Initial Data」面板编辑表的初始数据
5. **重新加载**：若手动修改了本地文件，点击右上角「Reload from Disk」放弃内存修改并重新读取

## 目录结构约定

> 您可以创建一个空文件夹，然后在可视化界面中进行编辑即可，无需手动创建下列文件

项目要求被编辑的文件夹遵循以下结构：

```
your-schema-folder/
├── common.json          # 公共字段引用和默认配置（与版本无关）
└── current/             # 当前正在编辑的版本（固定名）
    ├── database.json    # schema 排序等当前版本相关配置
    └── schemas/
        └── <schema>/    # 文件名友好的模式名（处理掉特殊字符）
            ├── schema.json  # schema 原始名称 + table 排序
            └── <table>/     # 文件名友好的表名
                ├── table.json        # 表配置项（字段定义、索引等）
                └── initial-data.json # 行内化的初始数据 (可选)
```

> 旧结构（`schemas/<schema>.json` + 平行 `initial-data/` 目录）仍可被识别，首次打开时会提示升级到上述新结构。

---

如需了解项目架构或参与开发，请参阅 [DEVELOPMENT.md](./DEVELOPMENT.md)。

项目正在进行渐进式重构，方案与进度详见 [docs/refactor/](./docs/refactor/README.md)。
