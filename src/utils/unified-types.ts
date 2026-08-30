import type { UnifiedTypeDefinition } from '@/types/schema'

/**
 * 内置默认统一类型集 — 首次加载时若 common.json 中无 unified_types 则自动填充
 *
 */
export const DEFAULT_UNIFIED_TYPES: UnifiedTypeDefinition[] = [
  /**
   * SQLite 采用「类型亲和（type affinity）」而非严格类型，此处按官方亲和规则映射：
   * 整数→INTEGER、浮点→REAL、精确小数→NUMERIC、其余（文本/日期/JSON/UUID）→TEXT。
   */
  {
    name: 'String',
    description: '变长字符串',
    quote_default: true,
    mysql: { type: 'VARCHAR'/*, length: 255*/ },
    postgresql: { type: 'VARCHAR'/*, length: 255*/ },
    sqlite: { type: 'TEXT' },
  },
  {
    name: 'Integer',
    description: '整数',
    quote_default: false,
    mysql: { type: 'INT'/*, length: 11*/ },
    postgresql: { type: 'INTEGER' },
    sqlite: { type: 'INTEGER' },
  },
  {
    name: 'BigInt',
    description: '大整数',
    quote_default: false,
    mysql: { type: 'BIGINT'/*, length: 20*/ },
    postgresql: { type: 'BIGINT' },
    sqlite: { type: 'INTEGER' },
  },
  {
    name: 'Boolean',
    description: '布尔值',
    quote_default: false,
    default_input: 'boolean',
    mysql: { type: 'TINYINT', length: 1 },
    postgresql: { type: 'BOOLEAN' },
    sqlite: { type: 'INTEGER', length: 1 },
  },
  {
    name: 'Text',
    description: '长文本',
    quote_default: true,
    mysql: { type: 'TEXT' },
    postgresql: { type: 'TEXT' },
    sqlite: { type: 'TEXT' },
  },
  {
    name: 'LongText',
    description: '超长文本',
    quote_default: true,
    mysql: { type: 'LONGTEXT' },
    postgresql: { type: 'TEXT' },
    sqlite: { type: 'TEXT' },
  },
  {
    name: 'Decimal',
    description: '精确小数',
    quote_default: false,
    mysql: { type: 'DECIMAL'/*, length: 10, scale: 2*/ },
    postgresql: { type: 'DECIMAL'/*, length: 10, scale: 2*/ },
    sqlite: { type: 'NUMERIC'/*, length: 10, scale: 2*/ },
  },
  {
    name: 'Float',
    description: '单精度浮点',
    quote_default: false,
    mysql: { type: 'FLOAT' },
    postgresql: { type: 'REAL' },
    sqlite: { type: 'REAL' },
  },
  {
    name: 'Double',
    description: '双精度浮点',
    quote_default: false,
    mysql: { type: 'DOUBLE' },
    postgresql: { type: 'DOUBLE PRECISION' },
    sqlite: { type: 'REAL' },
  },
  {
    name: 'Date',
    description: '日期',
    quote_default: true,
    mysql: { type: 'DATE' },
    postgresql: { type: 'DATE' },
    sqlite: { type: 'TEXT' },
  },
  {
    name: 'DateTime',
    description: '日期时间',
    quote_default: true,
    mysql: { type: 'DATETIME' },
    postgresql: { type: 'TIMESTAMP' },
    sqlite: { type: 'TEXT' },
  },
  {
    name: 'Timestamp',
    description: '时间戳',
    quote_default: true,
    mysql: { type: 'TIMESTAMP' },
    postgresql: { type: 'TIMESTAMPTZ' },
    sqlite: { type: 'TEXT' },
  },
  {
    name: 'JSON',
    description: 'JSON 数据',
    quote_default: true,
    mysql: { type: 'JSON' },
    postgresql: { type: 'JSONB' },
    sqlite: { type: 'TEXT' },
  },
  {
    name: 'UUID',
    description: 'UUID',
    quote_default: true,
    mysql: { type: 'CHAR', length: 36 },
    postgresql: { type: 'UUID' },
    sqlite: { type: 'TEXT', length: 36 },
  },
]
