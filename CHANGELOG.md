# Changelog


## v0.3.3

[compare changes](https://github.com/zhang-brook/schema-editor/compare/v0.3.2...v0.3.3)

### 📖 文档

- 新增发布流程说明文档 ([895aa7b](https://github.com/zhang-brook/schema-editor/commit/895aa7b))

### 🤖 持续集成

- 部署改为 tag 触发并自动创建 GitHub Release ([46ad35f](https://github.com/zhang-brook/schema-editor/commit/46ad35f))

## v0.3.2

[compare changes](https://github.com/zhang-brook/schema-editor/compare/v0.3.1...v0.3.2)

### 🚀 新功能

- 弹窗支持回车确认 ([38318b5](https://github.com/zhang-brook/schema-editor/commit/38318b5))
- 关于页面新增更新日志链接 ([ab1d510](https://github.com/zhang-brook/schema-editor/commit/ab1d510))
- 更新日志链接定位到当前版本对应小节 ([420c397](https://github.com/zhang-brook/schema-editor/commit/420c397))

### 🩹 问题修复

- 升级确认弹窗被加载遮罩遮挡无法点击 ([b6977e6](https://github.com/zhang-brook/schema-editor/commit/b6977e6))
- **sql-generator:** 修正 MySQL/PostgreSQL 注释的换行与反斜杠转义 ([04e9a9c](https://github.com/zhang-brook/schema-editor/commit/04e9a9c))

### 🏡 杂项

- 补充 package.json 作者、许可证与仓库信息 ([2486820](https://github.com/zhang-brook/schema-editor/commit/2486820))
- 版本号提升至 0.3.2 ([074d298](https://github.com/zhang-brook/schema-editor/commit/074d298))
- 接入 changelogen 按 tag 自动生成 CHANGELOG ([28bf379](https://github.com/zhang-brook/schema-editor/commit/28bf379))

### 🎨 代码风格

- 代码格式化 ([df9e89a](https://github.com/zhang-brook/schema-editor/commit/df9e89a))

## v0.3.1

[compare changes](https://github.com/zhang-brook/schema-editor/compare/v0.3.0...v0.3.1)

### 🚀 新功能

- 未打开项目时增加文件夹打开插画空状态提示 ([6c03b91](https://github.com/zhang-brook/schema-editor/commit/6c03b91))
- 新增项目级 SQL 输出方言启用配置 ([25f52f6](https://github.com/zhang-brook/schema-editor/commit/25f52f6))
- 表基础信息新增「更多设置」折叠区收纳表前注释与分区等配置 ([bb4f805](https://github.com/zhang-brook/schema-editor/commit/bb4f805))
- 新增项目信息配置，名称展示于网页标题与菜单栏 ([868d146](https://github.com/zhang-brook/schema-editor/commit/868d146))

### ♻️ 代码重构

- 抽取通用配置面板为独立子组件 ([455703b](https://github.com/zhang-brook/schema-editor/commit/455703b))
- 统一数据库默认配置文案为「数据库名 + 默认配置」格式 ([d6913bc](https://github.com/zhang-brook/schema-editor/commit/d6913bc))
- 重构项目设置为三子 tab 页面并移除全局配置入口 ([d2d77cc](https://github.com/zhang-brook/schema-editor/commit/d2d77cc))
- 抽取 SegmentedSwitch 组件并合并数据库默认配置面板 ([90709df](https://github.com/zhang-brook/schema-editor/commit/90709df))
- 抽取 PageTabs 组件并替换各页面重复的页签实现 ([bc7b92c](https://github.com/zhang-brook/schema-editor/commit/bc7b92c))
- 重组组件目录结构，按 settings/structure/ui/common 分层 ([5293ebe](https://github.com/zhang-brook/schema-editor/commit/5293ebe))

### 🏡 杂项

- 格式化 AboutModal 与 build-info 代码风格 ([0e7ac8c](https://github.com/zhang-brook/schema-editor/commit/0e7ac8c))

## v0.3.0

[compare changes](https://github.com/zhang-brook/schema-editor/compare/5bc84ed...v0.3.0)

### 🚀 新功能

- Create schema editor ([3879e05](https://github.com/zhang-brook/schema-editor/commit/3879e05))
- Add GitHub Actions workflow for deployment to GitHub Pages ([a9dc953](https://github.com/zhang-brook/schema-editor/commit/a9dc953))
- Implement file system access API for project auto-sync ([fd70839](https://github.com/zhang-brook/schema-editor/commit/fd70839))
- 显示表注释 ([d840b46](https://github.com/zhang-brook/schema-editor/commit/d840b46))
- 支持SQL预览及实时生成SQL ([591e96d](https://github.com/zhang-brook/schema-editor/commit/591e96d))
- 支持生成包含所有 schema 的汇总文件 (__all_schemas__.sql) ([dfba1c2](https://github.com/zhang-brook/schema-editor/commit/dfba1c2))
- 支持配置表初始数据 ([c60f607](https://github.com/zhang-brook/schema-editor/commit/c60f607))
- Schema 支持新建、删除、重命名；表支持拖拽排序 ([68f5047](https://github.com/zhang-brook/schema-editor/commit/68f5047))
- 将 SQL Preview 的 dialect 切换从下拉框改为 Tab 样式 ([036b43a](https://github.com/zhang-brook/schema-editor/commit/036b43a))
- Sidebar 中 schema 支持折叠/展开 ([7de6c0d](https://github.com/zhang-brook/schema-editor/commit/7de6c0d))
- Common Used Fields 支持编辑 ([7217d7d](https://github.com/zhang-brook/schema-editor/commit/7217d7d))
- Common Used Fields 字段支持排序 ([f4d4565](https://github.com/zhang-brook/schema-editor/commit/f4d4565))
- 支持跨 schema 拖拽移动表 ([e49e99b](https://github.com/zhang-brook/schema-editor/commit/e49e99b))
- 右上角添加 "从磁盘重新加载" 按钮（有时直接编辑了本地的文件，而页面中还是选择文件的那个版本，所以需要放弃网页中的改动，直接重新从本地文件读取一遍） ([391887b](https://github.com/zhang-brook/schema-editor/commit/391887b))
- Schema 支持拖拽排序 ([71cfbe7](https://github.com/zhang-brook/schema-editor/commit/71cfbe7))
- 编辑 initial data 后保存 `__initial_data__.sql` 到本地 ([357a1b7](https://github.com/zhang-brook/schema-editor/commit/357a1b7))
- 支持为 initial data 添加行注释和字段注释 ([6b59181](https://github.com/zhang-brook/schema-editor/commit/6b59181))
- 表的 Initial Data 支持排序 ([997931b](https://github.com/zhang-brook/schema-editor/commit/997931b))
- Initial Data 生成文件注释优化 ([07620f1](https://github.com/zhang-brook/schema-editor/commit/07620f1))
- FormatSqlValue 不同方言处理方案不同，移至方言生成脚本中 ([37ed246](https://github.com/zhang-brook/schema-editor/commit/37ed246))
- 实现 i18n (支持 English, 简体中文和繁体中文) ([a867140](https://github.com/zhang-brook/schema-editor/commit/a867140))
- 为 PostgreSQL 生成器添加标识符双引号配置 (支持配置标识符是否加双引号) ([8667db9](https://github.com/zhang-brook/schema-editor/commit/8667db9))
- 添加浏览器兼容性检查提示 ([697401c](https://github.com/zhang-brook/schema-editor/commit/697401c))
- 导航栏右上角添加 GitHub 链接 ([2cefe34](https://github.com/zhang-brook/schema-editor/commit/2cefe34))
- 新增结构调整后自动升级逻辑；优化索引列选择体验；支持索引列配置排序 (ASC, DESC) ([38b328b](https://github.com/zhang-brook/schema-editor/commit/38b328b))
- 索引列支持下拉框选择 ([68c70e0](https://github.com/zhang-brook/schema-editor/commit/68c70e0))
- **dev:** 开发环境支持局域网调试 ([ef52355](https://github.com/zhang-brook/schema-editor/commit/ef52355))
- 引入顶层统一类型映射数据库方言类型概念 (兼容历史项目结构) ([1a50b70](https://github.com/zhang-brook/schema-editor/commit/1a50b70))
- 公共字段的字段类型也允许从统一类型定义中选择 ([4e7e636](https://github.com/zhang-brook/schema-editor/commit/4e7e636))
- 统一类型定义 类型名调整后，对应的表的字段和公共配置的列，涉及到的相关下拉框都需要同步更新 ([29f73a7](https://github.com/zhang-brook/schema-editor/commit/29f73a7))
- 自定义类型的字段也展示“最终解析类型预览” ([ba47c55](https://github.com/zhang-brook/schema-editor/commit/ba47c55))
- 支持配置字段类型输出为大写/小写/大驼峰/保持默认 ([2086b47](https://github.com/zhang-brook/schema-editor/commit/2086b47))
- 表格支持拖拽排序 (行前添加拖拽按钮，按住拖动即可排序) ([e968682](https://github.com/zhang-brook/schema-editor/commit/e968682))
- 统一类型定义支持配置字段的小数点位数 ([94f3a4d](https://github.com/zhang-brook/schema-editor/commit/94f3a4d))
- 统一类型定义 支持指定字段默认值是否添加引号 (比如字符串就要添加，数字、布尔值等不要添加) 如果用户选择了自定义类型，给一个复选框，然用户自己选择默认值是否需要用引号包裹 ([2f18f84](https://github.com/zhang-brook/schema-editor/commit/2f18f84))
- **common-config:** 统一类型支持字段长度和小数位占位符显示 ([f6ffd76](https://github.com/zhang-brook/schema-editor/commit/f6ffd76))
- **field:** 支持字段默认值是否加引号及相关优化 ([1473c90](https://github.com/zhang-brook/schema-editor/commit/1473c90))
- **schema:** 增加字段长度和小数位的禁用控制功能 ([556a1e4](https://github.com/zhang-brook/schema-editor/commit/556a1e4))
- 支持配置默认值输入方式 ([b2a0e0f](https://github.com/zhang-brook/schema-editor/commit/b2a0e0f))
- 公共配置中的字段默认值组件也支持多种配置 ([bc4f49f](https://github.com/zhang-brook/schema-editor/commit/bc4f49f))
- 把"最终解析类型预览"加到 CommonConfigPanel 的展开行里 ([881869e](https://github.com/zhang-brook/schema-editor/commit/881869e))
- 存在方言覆盖的位置展示⚡图标 ([bf41b4f](https://github.com/zhang-brook/schema-editor/commit/bf41b4f))
- 实现 SQL 词法分析器 ([44c2897](https://github.com/zhang-brook/schema-editor/commit/44c2897))
- 实现核心解析器 ([7f36cef](https://github.com/zhang-brook/schema-editor/commit/7f36cef))
- 实现 类型映射器 和 方言检测器 ([a0675da](https://github.com/zhang-brook/schema-editor/commit/a0675da))
- 导入 SQL 功能集成 ([fc9fd31](https://github.com/zhang-brook/schema-editor/commit/fc9fd31))
- 关闭项目按钮 ([5d2d8c5](https://github.com/zhang-brook/schema-editor/commit/5d2d8c5))
- 添加 "关于" 弹窗 ([dd6b631](https://github.com/zhang-brook/schema-editor/commit/dd6b631))
- 项目 logo 设计 ([1799df9](https://github.com/zhang-brook/schema-editor/commit/1799df9))
- 重构顶部 toolbar，将其完善为下拉菜单 ([2a29abd](https://github.com/zhang-brook/schema-editor/commit/2a29abd))
- 添加字段时不弹出弹窗 而是直接追加到最后 ([6c63b4a](https://github.com/zhang-brook/schema-editor/commit/6c63b4a))
- 重构添加公共字段引用弹窗，交互更符合使用习惯 ([be9eef4](https://github.com/zhang-brook/schema-editor/commit/be9eef4))
- 关于页面添加 “在 GitHub 上查看” 链接 ([d57bbce](https://github.com/zhang-brook/schema-editor/commit/d57bbce))
- 支持在全局维度、schema维度、表维度、初始数据维度配置前置、后置SQL语句 ([119163e](https://github.com/zhang-brook/schema-editor/commit/119163e))
- 表结构页 Tab 标签 ([ec95e39](https://github.com/zhang-brook/schema-editor/commit/ec95e39))
- 表基本信息表格代码抽至 TableBasicInfo 组件 ([28868fa](https://github.com/zhang-brook/schema-editor/commit/28868fa))
- 初始数据 SQL 支持预览 ([afde68b](https://github.com/zhang-brook/schema-editor/commit/afde68b))
- 导入 SQL 弹窗输入框前添加行号 ([cb35bff](https://github.com/zhang-brook/schema-editor/commit/cb35bff))
- 初始数据 JSON 支持格式化 ([1c021ce](https://github.com/zhang-brook/schema-editor/commit/1c021ce))
- 支持将文件夹拖进网页以打开 ([d6fc316](https://github.com/zhang-brook/schema-editor/commit/d6fc316))
- 导入 PostgreSQL 方言 SQL 时自动尝试匹配现有 Schema ([87ce244](https://github.com/zhang-brook/schema-editor/commit/87ce244))
- DROP TABLE IF EXISTS + CREATE TABLE 支持全局设置成 CREATE TABLE IF NOT EXISTS ([8341610](https://github.com/zhang-brook/schema-editor/commit/8341610))
- 优化 DDL 生成选项，支持生成不含 DROP 语句的 CREATE TABLE ([a68de12](https://github.com/zhang-brook/schema-editor/commit/a68de12))
- 导入 SQL 弹窗支持修改表名 ([160c570](https://github.com/zhang-brook/schema-editor/commit/160c570))
- 检测到磁盘文件变化后询问用户是否重新加载 ([57339f6](https://github.com/zhang-brook/schema-editor/commit/57339f6))
- 优化文件系统观察者的变更检测：仅关注特定文件的变更 ([2dea611](https://github.com/zhang-brook/schema-editor/commit/2dea611))
- 修复 SQL 文本框输入内容行数过多时文本框样式展示错位问题 ([7db4ac0](https://github.com/zhang-brook/schema-editor/commit/7db4ac0))
- 左侧 Sidebar 添加导入 SQL 按钮 ([fb9836d](https://github.com/zhang-brook/schema-editor/commit/fb9836d))
- 规范化 CSS 样式定义 ([287f288](https://github.com/zhang-brook/schema-editor/commit/287f288))
- Modal 弹窗支持按 ESC 关闭 ([760feeb](https://github.com/zhang-brook/schema-editor/commit/760feeb))
- CSS 样式规范化 ([3192964](https://github.com/zhang-brook/schema-editor/commit/3192964))
- CSS 样式规范化 ([934737c](https://github.com/zhang-brook/schema-editor/commit/934737c))
- 索引支持添加 comment 备注 ([c385511](https://github.com/zhang-brook/schema-editor/commit/c385511))
- 允许初始数据选择某行不生成 ([91e94bd](https://github.com/zhang-brook/schema-editor/commit/91e94bd))
- 新增 dialect-resolver 方言解析辅助函数 ([ff61a6f](https://github.com/zhang-brook/schema-editor/commit/ff61a6f))
- 新增 src/core/workspace/layout.ts 路径常量与 sanitizeName ([76ad8b1](https://github.com/zhang-brook/schema-editor/commit/76ad8b1))
- 新增 src/core/workspace/handles.ts 句柄获取原语 ([6422e3e](https://github.com/zhang-brook/schema-editor/commit/6422e3e))
- 新结构 current/ 读写全链路 ([483869e](https://github.com/zhang-brook/schema-editor/commit/483869e))
- 新增 src/core/workspace/paths.ts 业务路径解析 ([9f3d44e](https://github.com/zhang-brook/schema-editor/commit/9f3d44e))
- 新增 CURRENT_STRUCT_VERSION 与 struct_version 版本判定 ([fc8cf16](https://github.com/zhang-brook/schema-editor/commit/fc8cf16))
- 实现逐版本结构迁移链（structure-migrations 注册表+脚本） ([e7e9c0a](https://github.com/zhang-brook/schema-editor/commit/e7e9c0a))
- Editor 打开检测旧结构并接入升级确认流程 ([7d369ca](https://github.com/zhang-brook/schema-editor/commit/7d369ca))
- 升级/打开项目全局加载遮罩 ([dfc4b3b](https://github.com/zhang-brook/schema-editor/commit/dfc4b3b))
- 新增命令模式核心模块与按需写盘类型 ([ae10b58](https://github.com/zhang-brook/schema-editor/commit/ae10b58))
- Editor 与组件接入命令模式 undo/redo 与按需写盘 ([c7b9d45](https://github.com/zhang-brook/schema-editor/commit/c7b9d45))
- 工具栏接入 undo/redo 按钮与快捷键，补充 history 文案 ([55d7b9b](https://github.com/zhang-brook/schema-editor/commit/55d7b9b))
- 引入 field_id/table_id/schema_id 延迟生成与基线/迁移核心模块 ([4524d64](https://github.com/zhang-brook/schema-editor/commit/4524d64))
- Editor store 接入基线/迁移（延迟补齐 id、创建快照、diff、迁移 DDL 预览） ([911e6e4](https://github.com/zhang-brook/schema-editor/commit/911e6e4))
- 工具栏接入基线/迁移弹窗（创建基线、迁移脚本编辑与 DDL 预览） ([7c20138](https://github.com/zhang-brook/schema-editor/commit/7c20138))
- 将右上角的撤消重做，放到左上角的菜单中 ([8889cd0](https://github.com/zhang-brook/schema-editor/commit/8889cd0))
- 打开文件夹、关闭文件夹绑定快捷键 ([a780c3c](https://github.com/zhang-brook/schema-editor/commit/a780c3c))
- 基线版本预览 ([4a012bb](https://github.com/zhang-brook/schema-editor/commit/4a012bb))
- 版本管理 -> 迁移脚本 UX交互体验优化 ([a4e2f81](https://github.com/zhang-brook/schema-editor/commit/a4e2f81))
- 新增 AI JSON 结构指南生成功能（生成到用户打开的文件夹） ([58daaf6](https://github.com/zhang-brook/schema-editor/commit/58daaf6))
- 生成表的SQL时，支持配置针对方言的 partition by 分区表相关逻辑 ([806eb25](https://github.com/zhang-brook/schema-editor/commit/806eb25))
- 支持复合主键 ([1a513a3](https://github.com/zhang-brook/schema-editor/commit/1a513a3))
- 打开项目时并发读取以解决表数量较多时项目加载耗时很长问题 ([bda6364](https://github.com/zhang-brook/schema-editor/commit/bda6364))
- 新增 Schema 与表复制功能 ([2883ee4](https://github.com/zhang-brook/schema-editor/commit/2883ee4))
- 优化侧边栏交互 ([0d3a44d](https://github.com/zhang-brook/schema-editor/commit/0d3a44d))
- 更新 todo.txt ([2859722](https://github.com/zhang-brook/schema-editor/commit/2859722))
- 未打开项目时点击空白区域可打开「打开文件夹」弹窗 ([113bdc0](https://github.com/zhang-brook/schema-editor/commit/113bdc0))
- Schema 名称改为原地行内编辑替代 prompt 弹窗 ([27fa928](https://github.com/zhang-brook/schema-editor/commit/27fa928))
- 字段注释支持自动拼接选项含义，索引名支持前后缀徽标编辑 ([2214b99](https://github.com/zhang-brook/schema-editor/commit/2214b99))
- 新增 SQLite 方言支持（生成、解析、迁移、UI 全链路） ([38abaff](https://github.com/zhang-brook/schema-editor/commit/38abaff))
- 字段注释支持多行输入，SQL 生成时正确转义换行 ([e1756a7](https://github.com/zhang-brook/schema-editor/commit/e1756a7))
- 关于弹窗展示构建时间与 Git 提交信息 ([5b3e1d4](https://github.com/zhang-brook/schema-editor/commit/5b3e1d4))

### 🩹 问题修复

- 修复代码注释乱码 ([561f5ee](https://github.com/zhang-brook/schema-editor/commit/561f5ee))
- 修复编译报错 ([8e13a9a](https://github.com/zhang-brook/schema-editor/commit/8e13a9a))
- 删除 schema 时同步删除 output目录中对应 sql 文件 ([80336e9](https://github.com/zhang-brook/schema-editor/commit/80336e9))
- 选择空文件夹时未展示 Common Config 配置项问题 ([c1f0677](https://github.com/zhang-brook/schema-editor/commit/c1f0677))
- 修复表无法拖拽到 schema 尾部问题 ([f0b0352](https://github.com/zhang-brook/schema-editor/commit/f0b0352))
- 将一个表拖到最后之后，它的位置变到了倒数第二个，而不是最后一个 ([f65a147](https://github.com/zhang-brook/schema-editor/commit/f65a147))
- 优化 schema 尾部拖拽区域布局稳定性 ([eb6bc5a](https://github.com/zhang-brook/schema-editor/commit/eb6bc5a))
- 修正空状态提示文案，将“表”改为“文件夹” ([0b4668d](https://github.com/zhang-brook/schema-editor/commit/0b4668d))
- 字段注释中包含单引号 (') 时需转为双单引号 ('') ([0a8b1f6](https://github.com/zhang-brook/schema-editor/commit/0a8b1f6))
- 重命名 schema 时，未删除 output 目录下旧 sql 文件 ([4fc7099](https://github.com/zhang-brook/schema-editor/commit/4fc7099))
- RenameSchema 旧 initial-data/<oldName>/ 目录未清理；moveTableToSchema 跨 schema 移动表时 initialDataMap key 未更新 ([cf5535b](https://github.com/zhang-brook/schema-editor/commit/cf5535b))
- 拖拽schema 调整顺序的时候，拖到某个schema的某两个表之间不应该显示引导线，拖到其他的 schema前的时候不应该显示虚线框引导，而应该显示引导线 ([a2d2bf2](https://github.com/zhang-brook/schema-editor/commit/a2d2bf2))
- 补充一处缺失的 i18n ([3467707](https://github.com/zhang-brook/schema-editor/commit/3467707))
- 下拉框空值回显问题 ([5f0bf3e](https://github.com/zhang-brook/schema-editor/commit/5f0bf3e))
- 统一类型定义表格-类型名输入框，每输入一个字符都会失焦问题 ([e86556b](https://github.com/zhang-brook/schema-editor/commit/e86556b))
- Ts 编译报错 ([f242a6f](https://github.com/zhang-brook/schema-editor/commit/f242a6f))
- Ts 类型报错 ([0fc2837](https://github.com/zhang-brook/schema-editor/commit/0fc2837))
- 用户字段类型选择 统一类型定义 中的选项后，在输出 SQL 中不生效问题 ([2728ca6](https://github.com/zhang-brook/schema-editor/commit/2728ca6))
- 修复表格排序拖拽逻辑误触发导致无法选中输入框文字问题 ([286632a](https://github.com/zhang-brook/schema-editor/commit/286632a))
- 修正公共字段字段类型与默认值联动边界情况导致脏数据问题 ([f417445](https://github.com/zhang-brook/schema-editor/commit/f417445))
- 公共字段表格 纯数字字段名排序始终在最前 无法正确排序问题 ([906d47a](https://github.com/zhang-brook/schema-editor/commit/906d47a))
- 运行报错 ([d04219e](https://github.com/zhang-brook/schema-editor/commit/d04219e))
- 修复 初始数据 切换至 JSON 选项下的两处小bug ([7a04cd4](https://github.com/zhang-brook/schema-editor/commit/7a04cd4))
- 修复编译报错 ([5c59853](https://github.com/zhang-brook/schema-editor/commit/5c59853))
- 修复导入 PostgreSQL 方言 SQL 时提示 Unrecognized column constraint: "false" 问题 ([8052010](https://github.com/zhang-brook/schema-editor/commit/8052010))
- 导入 PostgreSQL 方言建表语句 SQL 注释未正确解析问题 ([e534311](https://github.com/zhang-brook/schema-editor/commit/e534311))
- 不允许导入 SQL 输入框调整尺寸以免样式出现问题 ([516646c](https://github.com/zhang-brook/schema-editor/commit/516646c))
- PostgreSQL 索引备注属于模式，而不是属于表 ([fae306d](https://github.com/zhang-brook/schema-editor/commit/fae306d))
- 移除全局样式入口 index.css 及 main.ts 引用 ([99016af](https://github.com/zhang-brook/schema-editor/commit/99016af))
- 表名修改后 initial-data.json 被删除问题 ([a71f8ae](https://github.com/zhang-brook/schema-editor/commit/a71f8ae))
- [intlify] Fall back to translate 'toast.undo' key with 'en' locale ([893ef76](https://github.com/zhang-brook/schema-editor/commit/893ef76))
- 编辑公共配置时未被纳入 undo redo 历史 ([dfe5714](https://github.com/zhang-brook/schema-editor/commit/dfe5714))
- 当前打开一个新创建的空文件夹，也会提示要升级到新结构 ([9af5e1a](https://github.com/zhang-brook/schema-editor/commit/9af5e1a))
- 修复编译报错 ([54eba21](https://github.com/zhang-brook/schema-editor/commit/54eba21))
- 修复快捷键撤销重做与输入框原生冲突 ([db3079b](https://github.com/zhang-brook/schema-editor/commit/db3079b))
- 拖拽排序时，同时触发了 “释放以打开文件夹”的遮罩层 ([2668fd7](https://github.com/zhang-brook/schema-editor/commit/2668fd7))
- 索引未填写名称时自动回退生成并补充测试 ([e4f1f1e](https://github.com/zhang-brook/schema-editor/commit/e4f1f1e))
- MySQL 未填索引名时省略名称交由数据库自动命名 ([f36bc32](https://github.com/zhang-brook/schema-editor/commit/f36bc32))
- **mysql:** Mysql 不允许创建没有列的表 ([43f3df7](https://github.com/zhang-brook/schema-editor/commit/43f3df7))
- 修复 ts 编译报错 ([f3843cf](https://github.com/zhang-brook/schema-editor/commit/f3843cf))

### ♻️ 代码重构

- 类型化 FileSystem API 调用 ([76bc33b](https://github.com/zhang-brook/schema-editor/commit/76bc33b))
- 类型化 buildSchemaExportData 函数 ([b1a28cc](https://github.com/zhang-brook/schema-editor/commit/b1a28cc))
- 拆分 MySQL 和 PostgreSQL 的 sql 生成逻辑，通用函数放在一个代码文件中，特定方言的每个方言写一个代码文件，方便后期添加更多方言 ([2288b45](https://github.com/zhang-brook/schema-editor/commit/2288b45))
- 优化公共字段的类型展示及交互逻辑 ([e7bd6fd](https://github.com/zhang-brook/schema-editor/commit/e7bd6fd))
- 打开项目、从磁盘重新加载 相同逻辑复用 ([828661a](https://github.com/zhang-brook/schema-editor/commit/828661a))
- 统一弹窗组件目录结构 ([2d55d80](https://github.com/zhang-brook/schema-editor/commit/2d55d80))
- Pgsql 改为 postgresql (Struct Version 升级到 0.4) ([8a3c40b](https://github.com/zhang-brook/schema-editor/commit/8a3c40b))
- **style:** 抽取 quote-help-icon 为全局样式 ([7024b05](https://github.com/zhang-brook/schema-editor/commit/7024b05))
- **style:** 将全局样式迁移至各组件 scoped @import ([d165d0b](https://github.com/zhang-brook/schema-editor/commit/d165d0b))
- **style:** 改用 <style src> + @ 别名替代 scoped @import 相对路径 ([ce04adf](https://github.com/zhang-brook/schema-editor/commit/ce04adf))
- **style:** 恢复 App.vue 全局样式使用 scoped src ([f5b86c8](https://github.com/zhang-brook/schema-editor/commit/f5b86c8))
- Editor store 方言读取收敛至 dialect-resolver ([d239031](https://github.com/zhang-brook/schema-editor/commit/d239031))
- Sql-generator 方言读取收敛至 dialect-resolver ([36f0dde](https://github.com/zhang-brook/schema-editor/commit/36f0dde))
- Index-column-utils 方言读取收敛至 dialect-resolver ([48919f7](https://github.com/zhang-brook/schema-editor/commit/48919f7))
- 统一 SqlDialect 类型定义，全部使用 shared.ts 中的 SqlDialect ([6e3c751](https://github.com/zhang-brook/schema-editor/commit/6e3c751))
- Version-upgrader 收敛 @ts-expect-error 至 readLegacyField ([cdcf45c](https://github.com/zhang-brook/schema-editor/commit/cdcf45c))
- Editor.ts/file-helpers.ts 改用 workspace 路径层 ([4f3e0ef](https://github.com/zhang-brook/schema-editor/commit/4f3e0ef))
- Initial-data 行内化（消除四个平行数组，改用 InitialDataRow[]） ([6b7dc2c](https://github.com/zhang-brook/schema-editor/commit/6b7dc2c))
- 将公共配置及其他编辑操作纳入 undo/redo 命令历史 ([76bc99a](https://github.com/zhang-brook/schema-editor/commit/76bc99a))
- 基线迁移弹窗编辑状态逻辑优化 ([0cdfaff](https://github.com/zhang-brook/schema-editor/commit/0cdfaff))
- 简化关于弹窗标题文案 ([2ab4861](https://github.com/zhang-brook/schema-editor/commit/2ab4861))
- 统一使用新版项目设置布局，清理旧版残留 ([6d716b0](https://github.com/zhang-brook/schema-editor/commit/6d716b0))
- 未创建基线时也自动生成 field_id/table_id/schema_id/index_id/initial_data_id ([26d67d4](https://github.com/zhang-brook/schema-editor/commit/26d67d4))
- 将 STRUCTURE_MIGRATION_STEPS 抽取为独立文件 ([75233c3](https://github.com/zhang-brook/schema-editor/commit/75233c3))
- 合并重复的版本比较函数，统一使用 compareStructVersion ([a481081](https://github.com/zhang-brook/schema-editor/commit/a481081))
- 清理 todo.txt 中已实现的重构规划与噪声 ([8d61b4f](https://github.com/zhang-brook/schema-editor/commit/8d61b4f))
- 移除未使用的 store 导入与死代码 ([8cafd9c](https://github.com/zhang-brook/schema-editor/commit/8cafd9c))
- 生成表字段时非主键字段不添加 "primary_key": false ([9a8d20d](https://github.com/zhang-brook/schema-editor/commit/9a8d20d))
- 重命名“基线”为“版本” ([ff9398d](https://github.com/zhang-brook/schema-editor/commit/ff9398d))
- 并发写入 schema 与同步文件以加快项目打开速度 ([6302f54](https://github.com/zhang-brook/schema-editor/commit/6302f54))
- 重构 CSS 变量系统以提升设计一致性 ([7c819fb](https://github.com/zhang-brook/schema-editor/commit/7c819fb))
- 统一确认弹窗为队列驱动，绑定 Enter & ESC 快捷键 ([6b08fda](https://github.com/zhang-brook/schema-editor/commit/6b08fda))
- 优化侧边栏交互样式 ([ae6d2a8](https://github.com/zhang-brook/schema-editor/commit/ae6d2a8))
- 更新 GitHub 仓库地址 ([e20cbc4](https://github.com/zhang-brook/schema-editor/commit/e20cbc4))
- 统一使用 SqlDialect 类型替代重复的字面量联合类型 ([0eb7339](https://github.com/zhang-brook/schema-editor/commit/0eb7339))

### 📖 文档

- 完善 README 文档并修改页面标题 ([e2d1f94](https://github.com/zhang-brook/schema-editor/commit/e2d1f94))
- Add GitHub and preview links to README ([5fc1474](https://github.com/zhang-brook/schema-editor/commit/5fc1474))
- 更新 README 文档 ([4709fdb](https://github.com/zhang-brook/schema-editor/commit/4709fdb))
- 重写 README.md ([4fd560d](https://github.com/zhang-brook/schema-editor/commit/4fd560d))
- Update docs ([50afc19](https://github.com/zhang-brook/schema-editor/commit/50afc19))
- Update TODO.txt ([5b638ff](https://github.com/zhang-brook/schema-editor/commit/5b638ff))
- 创建重构总纲文档及第一批原子步骤规划 ([d4f5de7](https://github.com/zhang-brook/schema-editor/commit/d4f5de7))
- 移除已完成的样式 scoped 化重构文档 (01-style-scoped) ([be1abdf](https://github.com/zhang-brook/schema-editor/commit/be1abdf))
- 删除已实现功能的过时 .qoder spec 文档 ([5629fdd](https://github.com/zhang-brook/schema-editor/commit/5629fdd))
- 更新 DEVELOPMENT.md 目录结构描述并标注重构进行中 ([3526913](https://github.com/zhang-brook/schema-editor/commit/3526913))
- 更新 README.md 项目结构与重构链接 ([e1fe4b5](https://github.com/zhang-brook/schema-editor/commit/e1fe4b5))
- 完成文档清理批次并移除对应重构文档 ([00f0fa3](https://github.com/zhang-brook/schema-editor/commit/00f0fa3))
- 整理重构规划文档 ([f1a6f5d](https://github.com/zhang-brook/schema-editor/commit/f1a6f5d))
- 删除第1部分重构文档并标注统一路径层已落地 ([0655a0e](https://github.com/zhang-brook/schema-editor/commit/0655a0e))
- 更新重构总纲文档及第二批原子步骤规划 ([c916b31](https://github.com/zhang-brook/schema-editor/commit/c916b31))
- 更新 13-upgrade-button 实现状态与迁移架构 ([0ff7bed](https://github.com/zhang-brook/schema-editor/commit/0ff7bed))
- 更新 todo.txt 规划文档 ([7b70d21](https://github.com/zhang-brook/schema-editor/commit/7b70d21))
- 第11部分目录结构重构已落地，归档删除方案文档并同步引用；统一结构版本口径为 1.0 ([e060876](https://github.com/zhang-brook/schema-editor/commit/e060876))
- 归档 initial-data 行内化重构文档 ([f228b93](https://github.com/zhang-brook/schema-editor/commit/f228b93))
- 移除已落地的手动升级项目结构方案文档 ([2540a98](https://github.com/zhang-brook/schema-editor/commit/2540a98))
- 归档 undo/redo 重构文档并更新 README 进度表 ([043d6e2](https://github.com/zhang-brook/schema-editor/commit/043d6e2))
- 归档删除 15 基线/迁移设计文档，更新 README 与 00-background 决策口径；新增 nanoid 依赖 ([302789a](https://github.com/zhang-brook/schema-editor/commit/302789a))
- 新增项目代码组件划分评估报告 ([7e9b66d](https://github.com/zhang-brook/schema-editor/commit/7e9b66d))

### 🏡 杂项

- 关闭保存时自动格式化 ([f3fb511](https://github.com/zhang-brook/schema-editor/commit/f3fb511))
- 修改项目名称为 schema-editor ([8ca59db](https://github.com/zhang-brook/schema-editor/commit/8ca59db))
- 添加 pnpm 版本锁定 ([625e3ad](https://github.com/zhang-brook/schema-editor/commit/625e3ad))
- Configure base path for GitHub Actions ([31645f6](https://github.com/zhang-brook/schema-editor/commit/31645f6))
- 小改动 ([39ca605](https://github.com/zhang-brook/schema-editor/commit/39ca605))
- 更新版本号至 0.1.0 ([8c5c061](https://github.com/zhang-brook/schema-editor/commit/8c5c061))
- 更新版本号至 0.2.0 ([f349290](https://github.com/zhang-brook/schema-editor/commit/f349290))
- 更新 todo.txt 添加待办项 ([c07f928](https://github.com/zhang-brook/schema-editor/commit/c07f928))

### ✅ 测试

- 为 layout.ts 补充 sanitizeName 与路径常量 Vitest 单测 ([babaa03](https://github.com/zhang-brook/schema-editor/commit/babaa03))
- 为三大核心模块补充回归测试 ([5c49176](https://github.com/zhang-brook/schema-editor/commit/5c49176))

### 🎨 代码风格

- 优化图标显示与同步状态样式 ([4c449d9](https://github.com/zhang-brook/schema-editor/commit/4c449d9))
- 优化字段操作按钮布局 ([9b9d3b7](https://github.com/zhang-brook/schema-editor/commit/9b9d3b7))
- 代码注释规范化 ([9399a16](https://github.com/zhang-brook/schema-editor/commit/9399a16))
- **fields:** 优化字段长度和小数位禁用复选框样式和交互 ([8cb54c0](https://github.com/zhang-brook/schema-editor/commit/8cb54c0))

### 🤖 持续集成

- 修复 GitHub Action 打包流程 warning ([796cde0](https://github.com/zhang-brook/schema-editor/commit/796cde0))

