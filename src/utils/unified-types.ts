export interface UnifiedTypeDbMapping {
  type: string
  length?: number | null
}

export interface UnifiedTypeDefinition {
  name: string
  description?: string
  mysql: UnifiedTypeDbMapping
  pgsql: UnifiedTypeDbMapping
}

/** 内置默认统一类型集 — 首次加载时若 common.json 中无 unified_types 则自动填充 */
export const DEFAULT_UNIFIED_TYPES: UnifiedTypeDefinition[] = [
  {
    name: 'String',
    description: '变长字符串',
    mysql: { type: 'VARCHAR', length: 255 },
    pgsql: { type: 'VARCHAR', length: 255 },
  },
  {
    name: 'Integer',
    description: '整数',
    mysql: { type: 'INT', length: 11 },
    pgsql: { type: 'INTEGER' },
  },
  {
    name: 'BigInt',
    description: '大整数',
    mysql: { type: 'BIGINT', length: 20 },
    pgsql: { type: 'BIGINT' },
  },
  {
    name: 'Boolean',
    description: '布尔值',
    mysql: { type: 'TINYINT', length: 1 },
    pgsql: { type: 'BOOLEAN' },
  },
  {
    name: 'Text',
    description: '长文本',
    mysql: { type: 'TEXT' },
    pgsql: { type: 'TEXT' },
  },
  {
    name: 'LongText',
    description: '超长文本',
    mysql: { type: 'LONGTEXT' },
    pgsql: { type: 'TEXT' },
  },
  {
    name: 'Decimal',
    description: '精确小数',
    mysql: { type: 'DECIMAL', length: 10 },
    pgsql: { type: 'DECIMAL', length: 10 },
  },
  {
    name: 'Float',
    description: '单精度浮点',
    mysql: { type: 'FLOAT' },
    pgsql: { type: 'REAL' },
  },
  {
    name: 'Double',
    description: '双精度浮点',
    mysql: { type: 'DOUBLE' },
    pgsql: { type: 'DOUBLE PRECISION' },
  },
  {
    name: 'Date',
    description: '日期',
    mysql: { type: 'DATE' },
    pgsql: { type: 'DATE' },
  },
  {
    name: 'DateTime',
    description: '日期时间',
    mysql: { type: 'DATETIME' },
    pgsql: { type: 'TIMESTAMP' },
  },
  {
    name: 'Timestamp',
    description: '时间戳',
    mysql: { type: 'TIMESTAMP' },
    pgsql: { type: 'TIMESTAMPTZ' },
  },
  {
    name: 'JSON',
    description: 'JSON 数据',
    mysql: { type: 'JSON' },
    pgsql: { type: 'JSONB' },
  },
  {
    name: 'UUID',
    description: 'UUID',
    mysql: { type: 'CHAR', length: 36 },
    pgsql: { type: 'UUID' },
  },
]
