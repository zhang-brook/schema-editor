/**
 * 当前编辑器支持的「项目结构版本」。
 *
 * 作为结构版本的单一事实来源：写入新结构根 common.json 的 struct_version，
 * 并用于 `structure-migrations/` 的升级链判定与 `file-helpers.ts` 的版本比较。
 * 未来调整目录布局时，在此升版并在 structure-migrations 注册表追加对应迁移 step。
 */
export const CURRENT_STRUCT_VERSION = '1.0'

/**
 * 工作目录路径片段常量与文件名友好化规则（纯常量与字符串规则，无业务语义）。
 *
 * 作为整个项目的「路径单一事实来源」：目录重构（见 docs/refactor/11）后路径规则更复杂，
 * 所有路径拼接与句柄获取都应经本模块与 `handles.ts` / `paths.ts`，禁止在业务代码中散落硬编码。
 */

// ===== 旧结构（重构前）路径片段 =====

/** 根目录配置文件名 */
export const COMMON_FILE = 'common.json'

/** 旧结构：所有 schema 文件所在目录（根下） */
export const SCHEMAS_DIR = 'schemas'

/** 旧结构：初始数据目录（根下） */
export const INITIAL_DATA_DIR = 'initial-data'

/** 旧结构：SQL 输出目录（根下） */
export const OUTPUT_DIR = 'output'

// ===== 新结构（current/versions/migrations）路径片段 =====

/** 当前正在编辑的版本目录（固定名） */
export const CURRENT_DIR = 'current'

/** 历史版本快照目录 */
export const VERSIONS_DIR = 'versions'

/** 用户维护的迁移脚本目录 */
export const MIGRATIONS_DIR = 'migrations'

/** 当前版本下的 database.json（schema order + 与版本相关配置） */
export const DATABASE_FILE = 'database.json'

/** schema 目录下的 schema.json（schema 原始名称 + table 排序） */
export const SCHEMA_FILE = 'schema.json'

/** table 目录下的 table.json（表配置项） */
export const TABLE_FILE = 'table.json'

/** table 目录下的 initial-data.json（行内化初始数据） */
export const INITIAL_DATA_FILE = 'initial-data.json'

// ===== 文件名友好化 =====

/**
 * 将 schema / table 名称处理为文件名友好的片段：
 * - 文件系统非法字符（路径分隔符、Windows 保留字符等）统一替换为下划线；
 * - 折叠连续下划线，去除首尾下划线；
 * - 保留原名称大小写（便于回查原始名）。
 *
 * 仅用于「磁盘文件名」，原始语义名称仍存于 schema.json / table.json 内。
 */
export function sanitizeName(name: string): string {
  if (!name) return ''

  const replaced = name
    // 路径分隔符与常见非法字符
    .replace(/[/\\<>:"|?*]/g, '_')
    // 控制字符
    .replace(/[\x00-\x1f]/g, '_')
    // 折叠连续下划线
    .replace(/_+/g, '_')
    // 去除首尾下划线与空白
    .replace(/^_+|_+$/g, '')
    .trim()

  return replaced
}
