/**
 * CREATE TABLE 递归下降解析器
 *
 * 将 Token 流解析为 ParsedTable 中间表示。
 * 支持 MySQL 和 PostgreSQL 两种方言的 CREATE TABLE 语法。
 */

import { lex, type Token, TokenType } from './tokenizer'

// ===== 中间表示类型 =====

/** 解析后的列定义 */
export interface ParsedColumn {
  name: string
  rawType: string
  length?: number | null
  scale?: number | null
  notNull: boolean
  autoIncrement: boolean
  unique: boolean
  primaryKey: boolean
  defaultValue?: string | null
  comment?: string
  generatedIdentity?: 'ALWAYS' | 'BY_DEFAULT'
  isCommentedOut: boolean
  unsigned: boolean
}

/** 解析后的约束（表级） */
export interface ParsedConstraint {
  type: 'PRIMARY_KEY' | 'UNIQUE' | 'INDEX' | 'FULLTEXT' | 'SPATIAL'
  name?: string
  columns: ParsedConstraintColumn[]
  using?: string
  /** COMMENT '...' on index/constraint (MySQL inline syntax or PostgreSQL COMMENT ON INDEX) */
  comment?: string
}

export interface ParsedConstraintColumn {
  name: string
  sortOrder?: 'ASC' | 'DESC'
}

/** 表选项 */
export interface ParsedTableOptions {
  engine?: string
  charset?: string
  collation?: string
  autoIncrement?: number
  comment?: string
  rowFormat?: string
}

/** 解析后的完整表定义 */
export interface ParsedTable {
  name: string
  schema?: string
  comment?: string
  ifNotExists: boolean
  temporary: boolean
  columns: ParsedColumn[]
  constraints: ParsedConstraint[]
  options: ParsedTableOptions
}

/** 解析错误/警告 */
export interface ParseMessage {
  type: 'error' | 'warning'
  message: string
  line: number
  column: number
  tableName?: string
}

/** 顶层解析结果 */
export interface ParseResult {
  tables: ParsedTable[]
  messages: ParseMessage[]
}

// ===== 解析器状态 =====

class ParserState {
  tokens: Token[]
  pos: number
  messages: ParseMessage[]

  constructor(tokens: Token[]) {
    this.tokens = tokens
    this.pos = 0
    this.messages = []
  }

  current(): Token {
    return this.tokens[this.pos]!
  }

  peek(offset = 0): Token {
    return this.tokens[this.pos + offset]!
  }

  advance(): Token {
    const t = this.current()
    this.pos++
    return t
  }

  isEOF(): boolean {
    return this.current()?.type === TokenType.EOF
  }

  /** 检查当前 token 是否为指定类型的标识符或关键字 */
  isIdentOrKeyword(): boolean {
    const t = this.current()
    return t?.type === TokenType.IDENTIFIER ||
      t?.type === TokenType.BACKTICK_ID ||
      t?.type === TokenType.DOUBLEQUOTE_ID ||
      t?.type === TokenType.KEYWORD
  }

  /** 获取标识符名（处理各种引用格式和关键字） */
  getIdentValue(t: Token): string {
    if (t.type === TokenType.IDENTIFIER || t.type === TokenType.KEYWORD) {
      return t.value
    }
    if (t.type === TokenType.BACKTICK_ID || t.type === TokenType.DOUBLEQUOTE_ID) {
      return t.value
    }
    return t.value
  }

  /** 检查当前 token 的 value（大小写不敏感） */
  isKeyword(...words: string[]): boolean {
    const t = this.current()
    if (!t) return false
    if (t.type !== TokenType.KEYWORD) return false
    return words.some(w => t.value === w)
  }

  /** 消费一个 token 并检查其是否匹配 */
  matchKeyword(...words: string[]): Token | null {
    if (this.isKeyword(...words)) {
      return this.advance()
    }
    return null
  }

  /** 消费符号 token */
  matchSymbol(sym: string): boolean {
    const t = this.current()
    if (t?.type === TokenType.SYMBOL && t.value === sym) {
      this.advance()
      return true
    }
    return false
  }

  /** 跳过直到遇到分号或 EOF */
  skipToSemicolon(): void {
    while (!this.isEOF()) {
      const t = this.advance()
      if (t.type === TokenType.SYMBOL && t.value === ';') break
    }
  }

  /** 跳过直到遇到指定符号 */
  skipUntil(...syms: string[]): void {
    while (!this.isEOF()) {
      const t = this.current()
      if (t.type === TokenType.SYMBOL && syms.includes(t.value)) break
      this.advance()
    }
  }

  addError(msg: string, token?: Token, tableName?: string): void {
    const t = token || this.current()
    this.messages.push({
      type: 'error',
      message: msg,
      line: t?.line || 0,
      column: t?.column || 0,
      tableName,
    })
  }

  addWarning(msg: string, token?: Token, tableName?: string): void {
    const t = token || this.current()
    this.messages.push({
      type: 'warning',
      message: msg,
      line: t?.line || 0,
      column: t?.column || 0,
      tableName,
    })
  }
}

// ===== 主解析入口 =====

/**
 * 解析 SQL 文本中的 CREATE TABLE 语句
 */
export function parseCreateTableStatements(input: string): ParseResult {
  const tokens = lex(input)
  const state = new ParserState(tokens)

  const tables: ParsedTable[] = []

  while (!state.isEOF()) {
    // 跳过注释
    while (!state.isEOF() &&
      (state.current().type === TokenType.COMMENT_LINE ||
       state.current().type === TokenType.COMMENT_BLOCK)) {
      state.advance()
    }

    if (state.isEOF()) break

    // 处理 COMMENT ON TABLE / COMMENT ON COLUMN (PostgreSQL)
    if (state.isKeyword('COMMENT')) {
      parseCommentOnStatement(state, tables)
    }
    // 查找 CREATE TABLE
    else if (state.isKeyword('CREATE')) {
      const createToken = state.advance() // CREATE

      // OR REPLACE (PostgreSQL)
      state.matchKeyword('OR_REPLACE')

      // TEMPORARY / TEMP
      const isTemp = !!state.matchKeyword('TEMPORARY', 'TEMP')

      if (state.isKeyword('TABLE')) {
        state.advance() // TABLE

        try {
          const table = parseCreateTableBody(state)
          table.temporary = isTemp
          tables.push(table)
        } catch {
          // 如果解析失败，尝试跳到下一条语句
          state.skipToSemicolon()
        }
      } else if (state.isKeyword('SCHEMA')) {
        // CREATE SCHEMA — 跳过
        state.skipToSemicolon()
      } else {
        // 其他 CREATE 语句 — 跳过
        state.skipToSemicolon()
      }
    } else {
      // 非 CREATE 语句，跳到下一句
      state.skipToSemicolon()
    }
  }

  return { tables, messages: state.messages }
}

// ===== CREATE TABLE 主体解析 =====

function parseCreateTableBody(state: ParserState): ParsedTable {
  // IF NOT EXISTS
  const ifNotExists = !!state.matchKeyword('IF_NOT_EXISTS')

  // 表名（支持 schema.table 格式）
  const nameToken = state.current()
  if (!state.isIdentOrKeyword()) {
    state.addError('Expected table name', nameToken)
    throw new Error('Expected table name')
  }

  let tableName: string
  let schemaName: string | undefined

  const first = state.getIdentValue(state.advance())

  // 检查 schema.table 格式 (schema.name)
  if (state.matchSymbol('.')) {
    schemaName = first
    const secondToken = state.current()
    if (!state.isIdentOrKeyword()) {
      state.addError('Expected table name after dot', secondToken)
      throw new Error('Expected table name')
    }
    tableName = state.getIdentValue(state.advance())
  } else {
    tableName = first
  }

  // 检查 LIKE / AS SELECT 子查询（跳过不解析）
  if (state.isKeyword('LIKE') || (state.isKeyword('AS') && state.peek(1)?.type !== TokenType.SYMBOL)) {
    state.skipToSemicolon()
    return {
      name: tableName,
      schema: schemaName,
      ifNotExists,
      temporary: false,
      columns: [],
      constraints: [],
      options: {},
    }
  }

  // 检查 INHERITS (PostgreSQL)
  if (state.isKeyword('INHERITS')) {
    state.advance()
    state.skipUntil(';')
    // 跳过 INHERITS 子句的括号内容
    if (state.matchSymbol('(')) {
      let depth = 1
      while (!state.isEOF() && depth > 0) {
        const t = state.advance()
        if (t.type === TokenType.SYMBOL && t.value === '(') depth++
        if (t.type === TokenType.SYMBOL && t.value === ')') depth--
      }
    }
  }

  // 期望 '(' 开始列定义
  if (!state.matchSymbol('(')) {
    state.addError("Expected '(' after table name", state.current())
    throw new Error("Expected '('")
  }

  // 解析列定义和表级约束
  const columns: ParsedColumn[] = []
  const constraints: ParsedConstraint[] = []

  parseTableBody(state, columns, constraints)

  // 期望 ')' 结束
  if (!state.matchSymbol(')')) {
    state.addError("Expected ')' to close column definitions", state.current())
    // 尝试恢复：跳过直到 )
    state.skipUntil(')', ';')
    state.matchSymbol(')')
  }

  // 解析表选项
  const options = parseTableOptions(state)

  // 期望 ';'
  state.matchSymbol(';')

  return {
    name: tableName,
    schema: schemaName,
    ifNotExists,
    temporary: false,
    columns,
    constraints,
    options,
  }
}

// ===== 表体解析（列定义 + 约束） =====

function parseTableBody(
  state: ParserState,
  columns: ParsedColumn[],
  constraints: ParsedConstraint[],
): void {
  while (!state.isEOF()) {
    // 跳过注释
    while (!state.isEOF() &&
      (state.current().type === TokenType.COMMENT_LINE ||
       state.current().type === TokenType.COMMENT_BLOCK)) {
      state.advance()
    }

    // 结束条件
    const t = state.current()
    if (t.type === TokenType.SYMBOL && t.value === ')') break
    if (t.type === TokenType.EOF) break

    // 检查是否有行内注释标记该字段被注释掉
    // (通过前一个 token 是否为 COMMENT_LINE 来判断)
    // 实际我们通过检查字段定义前是否有 --  前缀来判断

    // 尝试解析列定义或约束
    const savedPos = state.pos
    const savedMsgs = state.messages.length

    // 先尝试解析为 CONSTRAINT name ...
    if (state.isKeyword('CONSTRAINT')) {
      const constraint = parseNamedConstraint(state)
      if (constraint) {
        constraints.push(constraint)
        state.matchSymbol(',')
        continue
      }
    }

    // 尝试解析为表级约束（PRIMARY KEY, UNIQUE, INDEX, KEY, FULLTEXT, SPATIAL）
    if (isTableConstraintStart(state)) {
      const constraint = parseTableConstraint(state)
      if (constraint) {
        constraints.push(constraint)
        state.matchSymbol(',')
        continue
      }
    }

    // 回退，尝试解析列定义
    state.pos = savedPos
    state.messages.length = savedMsgs

    // 检查是否为带注释的字段（前一token是COMMENT_LINE且内容以--开头很可能是被注释的）
    // 对于 is_commented_out 字段，我们仍然解析但标记为已注释
    // 实际上在 tokenize 阶段行注释已经被剥离，所以我们需要另一种方式检测
    // 简化处理：先按正常列解析
    
    const column = parseColumnDef(state)
    if (column) {
      columns.push(column)
      state.matchSymbol(',')
      continue
    }

    // 无法识别，跳过到 , 或 )
    state.addWarning('Skipping unrecognized element in table body', state.current())
    state.skipUntil(',', ')')
    state.matchSymbol(',')
  }
}

// ===== 列定义解析 =====

function parseColumnDef(state: ParserState): ParsedColumn | null {
  const startToken = state.current()

  // 读取列名
  if (!state.isIdentOrKeyword()) {
    return null
  }
  const name = state.getIdentValue(state.advance())

  // 读取类型名
  let rawType = ''
  let length: number | null = null
  let scale: number | null = null

  // 处理 PostgreSQL DOUBLE PRECISION 复合类型
  if (state.isKeyword('DOUBLE_PRECISION')) {
    rawType = state.advance().value
  }
  // 处理 PostgreSQL CHARACTER VARYING
  else if (state.isKeyword('CHARACTER')) {
    state.advance()
    if (state.isKeyword('VARYING')) {
      state.advance()
      rawType = 'CHARACTER VARYING'
    } else {
      rawType = 'CHARACTER'
    }
  }
  // 处理 PostgreSQL TIMESTAMP WITH/WITHOUT TIME ZONE
  else if (state.isKeyword('TIMESTAMP') || state.isKeyword('TIME')) {
    rawType = state.advance().value
    if (state.isKeyword('WITHOUT_TZ')) {
      state.advance()
      rawType += ' WITHOUT TIME ZONE'
    } else if (state.isKeyword('WITH_TZ')) {
      state.advance()
      rawType += ' WITH TIME ZONE'
    }
  }
  // 处理 PostgreSQL 类型转换符号 ::
  else if (state.current().type === TokenType.SYMBOL && state.current().value === '::') {
    // 类型已经在前面被解析为标识符了,这只是类型转换: 列名::类型
    // 这种情况在 CREATE TABLE 中不常见，跳过
    return null
  }
  // 普通类型名
  else if (state.isIdentOrKeyword()) {
    rawType = state.getIdentValue(state.advance())
  } else {
    state.addError(`Expected type for column "${name}"`, state.current())
    return null
  }

  // 处理 PostgreSQL ARRAY 类型后缀
  if (state.matchSymbol('[') && state.matchSymbol(']')) {
    rawType += '[]'
  }

  // 类型参数：VARCHAR(255), DECIMAL(10,2), ENUM('a','b')
  if (state.matchSymbol('(')) {
    // 检查是否是 ENUM/SET 的字符串列表
    if (state.current().type === TokenType.STRING) {
      // ENUM('a','b','c') — 收集所有值但不展开
      const enumVals: string[] = []
      while (!state.isEOF()) {
        const t = state.current()
        if (t.type === TokenType.STRING) {
          enumVals.push(t.value)
          state.advance()
        } else if (t.type === TokenType.COMMENT_LINE || t.type === TokenType.COMMENT_BLOCK) {
          state.advance()
        } else {
          break
        }
        state.matchSymbol(',')
      }
      state.matchSymbol(')')
      rawType += `(${enumVals.map(v => `'${v}'`).join(',')})`
    } else {
      // 数值参数: VARCHAR(255), DECIMAL(10,2)
      if (state.current().type === TokenType.NUMBER || state.current().type === TokenType.KEYWORD) {
        const lenStr = state.current().value
        const len = parseInt(lenStr, 10)
        if (!isNaN(len)) {
          length = len
          state.advance()
        }
      }
      if (state.matchSymbol(',')) {
        if (state.current().type === TokenType.NUMBER) {
          const scaleStr = state.current().value
          const sc = parseInt(scaleStr, 10)
          if (!isNaN(sc)) {
            scale = sc
            state.advance()
          }
        }
      }
      state.matchSymbol(')')
    }
  }

  // 列约束解析
  let notNull = false
  let autoIncrement = false
  let unique = false
  let primaryKey = false
  let defaultValue: string | undefined
  let comment: string | undefined
  let generatedIdentity: 'ALWAYS' | 'BY_DEFAULT' | undefined
  let unsigned = false

  // 循环解析列约束（直到遇到 , 或 )）
  let safety = 0
  while (!state.isEOF() && safety < 50) {
    safety++
    const t = state.current()

    if (t.type === TokenType.SYMBOL && (t.value === ',' || t.value === ')')) break
    if (t.type === TokenType.EOF) break

    // NOT NULL
    if (state.isKeyword('NOT_NULL')) {
      state.advance()
      notNull = true
      continue
    }

    // NULL (explicit nullable)
    if (state.isKeyword('NULL')) {
      state.advance()
      // notNull stays false (nullable)
      continue
    }

    // DEFAULT
    if (state.isKeyword('DEFAULT')) {
      state.advance()
      defaultValue = parseDefaultValue(state)
      continue
    }

    // AUTO_INCREMENT
    if (state.isKeyword('AUTO_INCREMENT')) {
      state.advance()
      autoIncrement = true
      continue
    }

    // PRIMARY KEY (column-level)
    if (state.isKeyword('PRIMARY_KEY')) {
      state.advance()
      primaryKey = true
      continue
    }

    // UNIQUE (column-level)
    if (state.isKeyword('UNIQUE')) {
      state.advance()
      // 可能后面跟着 KEY
      state.matchKeyword('KEY')
      unique = true
      continue
    }

    // COMMENT '...'
    if (state.isKeyword('COMMENT')) {
      state.advance()
      if (state.current().type === TokenType.STRING) {
        comment = state.advance().value
      }
      continue
    }

    // UNSIGNED
    if (state.isKeyword('UNSIGNED')) {
      state.advance()
      unsigned = true
      continue
    }

    // ZEROFILL
    if (state.isKeyword('ZEROFILL')) {
      state.advance()
      continue
    }

    // CHARACTER SET / CHARSET
    if (state.isKeyword('CHARACTER_SET') || state.isKeyword('CHARACTER') || state.isKeyword('CHARSET')) {
      state.advance()
      // 跳过 SET 如果还没消费
      state.matchKeyword('SET')
      // 跳过字符集名
      if (state.isIdentOrKeyword() || state.current().type === TokenType.STRING) {
        state.advance()
      }
      continue
    }

    // COLLATE
    if (state.isKeyword('COLLATE')) {
      state.advance()
      if (state.isIdentOrKeyword() || state.current().type === TokenType.STRING) {
        state.advance()
      }
      continue
    }

    // GENERATED ALWAYS AS IDENTITY / GENERATED BY DEFAULT AS IDENTITY (PostgreSQL)
    if (state.isKeyword('GENERATED_ALWAYS')) {
      state.advance()
      state.matchKeyword('AS_IDENTITY')
      generatedIdentity = 'ALWAYS'
      continue
    }
    if (state.isKeyword('GENERATED_BY_DEFAULT')) {
      state.advance()
      state.matchKeyword('AS_IDENTITY')
      generatedIdentity = 'BY_DEFAULT'
      continue
    }

    // ON UPDATE CURRENT_TIMESTAMP
    if (state.isKeyword('ON_UPDATE')) {
      state.advance()
      // 跳过 CURRENT_TIMESTAMP 及其参数
      if (state.isKeyword('CURRENT_TIMESTAMP') || state.isKeyword('NOW')) {
        state.advance()
        // 可能带括号参数
        if (state.matchSymbol('(')) {
          while (!state.isEOF() && !state.matchSymbol(')')) {
            state.advance()
          }
        }
      }
      continue
    }

    // REFERENCES (外键 — 跳过)
    if (state.isKeyword('REFERENCES')) {
      state.advance()
      // 跳过引用的表名
      if (state.isIdentOrKeyword()) state.advance()
      if (state.matchSymbol('(')) {
        let depth = 1
        while (!state.isEOF() && depth > 0) {
          const tt = state.advance()
          if (tt.type === TokenType.SYMBOL && tt.value === '(') depth++
          if (tt.type === TokenType.SYMBOL && tt.value === ')') depth--
        }
      }
      continue
    }

    // CHECK (跳过)
    if (state.isKeyword('CHECK')) {
      state.advance()
      if (state.matchSymbol('(')) {
        let depth = 1
        while (!state.isEOF() && depth > 0) {
          const tt = state.advance()
          if (tt.type === TokenType.SYMBOL && tt.value === '(') depth++
          if (tt.type === TokenType.SYMBOL && tt.value === ')') depth--
        }
      }
      continue
    }

    // 无法识别的约束 — 跳过
    state.addWarning(`Unrecognized column constraint: "${t.value}"`, t)
    state.advance()
  }

  return {
    name,
    rawType,
    length,
    scale,
    notNull,
    autoIncrement,
    unique,
    primaryKey,
    defaultValue,
    comment,
    generatedIdentity,
    isCommentedOut: false,
    unsigned,
  }
}

/** 解析 DEFAULT 值 */
function parseDefaultValue(state: ParserState): string | undefined {
  const t = state.current()

  // 字符串值
  if (t.type === TokenType.STRING) {
    return `'${state.advance().value}'`
  }

  // 数字
  if (t.type === TokenType.NUMBER) {
    return state.advance().value
  }

  // 关键字: NULL, CURRENT_TIMESTAMP, NOW(), TRUE, FALSE
  if (t.type === TokenType.KEYWORD) {
    const kw = t.value
    if (kw === 'NULL') {
      state.advance()
      return 'NULL'
    }
    if (kw === 'TRUE' || kw === 'FALSE') {
      state.advance()
      return kw
    }
    if (kw === 'CURRENT_TIMESTAMP' || kw === 'NOW') {
      state.advance()
      let result = kw
      // 可能带括号参数如 CURRENT_TIMESTAMP(3)
      if (state.matchSymbol('(')) {
        result += '('
        if (state.current().type === TokenType.NUMBER) {
          result += state.advance().value
        }
        state.matchSymbol(')')
        result += ')'
      }
      return result
    }
    // 其他关键字/函数作为字符串保存
    state.advance()
    return kw
  }

  // 符号（如 -1 的负号）
  if (t.type === TokenType.SYMBOL && t.value === '-') {
    state.advance()
    if (state.current().type === TokenType.NUMBER) {
      return '-' + state.advance().value
    }
    return '-'
  }

  return undefined
}

// ===== 表级约束检测与解析 =====

function isTableConstraintStart(state: ParserState): boolean {
  return state.isKeyword('PRIMARY_KEY', 'UNIQUE', 'INDEX', 'KEY', 'FULLTEXT', 'SPATIAL')
}

function parseTableConstraint(state: ParserState): ParsedConstraint | null {
  let type: ParsedConstraint['type']
  let name: string | undefined

  if (state.isKeyword('PRIMARY_KEY')) {
    state.advance()
    type = 'PRIMARY_KEY'
  } else if (state.isKeyword('UNIQUE')) {
    state.advance()
    type = 'UNIQUE'
    // UNIQUE KEY 或 UNIQUE INDEX
    state.matchKeyword('KEY', 'INDEX')
  } else if (state.isKeyword('FULLTEXT')) {
    state.advance()
    type = 'FULLTEXT'
    state.matchKeyword('KEY', 'INDEX')
  } else if (state.isKeyword('SPATIAL')) {
    state.advance()
    type = 'SPATIAL'
    state.matchKeyword('KEY', 'INDEX')
  } else if (state.isKeyword('INDEX') || state.isKeyword('KEY')) {
    state.advance()
    type = 'INDEX'
  } else {
    return null
  }

  // 可选的索引名
  if (state.isIdentOrKeyword()) {
    name = state.getIdentValue(state.advance())
  }

  // USING BTREE/HASH
  let using: string | undefined
  if (state.isKeyword('USING')) {
    state.advance()
    if (state.isIdentOrKeyword()) {
      using = state.getIdentValue(state.advance())
    }
  }

  // 列列表 (col1, col2, ...)
  if (!state.matchSymbol('(')) {
    state.addError("Expected '(' for constraint columns", state.current())
    return null
  }

  const columns: ParsedConstraintColumn[] = []
  while (!state.isEOF()) {
    const t = state.current()
    if (t.type === TokenType.SYMBOL && t.value === ')') break

    if (state.isIdentOrKeyword()) {
      const colName = state.getIdentValue(state.advance())
      let sortOrder: 'ASC' | 'DESC' | undefined

      // 可选的排序方向
      if (state.isKeyword('ASC')) {
        state.advance()
        sortOrder = 'ASC'
      } else if (state.isKeyword('DESC')) {
        state.advance()
        sortOrder = 'DESC'
      }

      // 可选的长度（用于索引前缀，MySQL）
      if (state.matchSymbol('(')) {
        if (state.current().type === TokenType.NUMBER) {
          state.advance()
        }
        state.matchSymbol(')')
      }

      columns.push({ name: colName, sortOrder })
    }

    state.matchSymbol(',')
  }

  state.matchSymbol(')')

  // 可选的 USING (在列列表之后)
  if (!using && state.isKeyword('USING')) {
    state.advance()
    if (state.isIdentOrKeyword()) {
      using = state.getIdentValue(state.advance())
    }
  }

  // 可选的 COMMENT '...' (MySQL 内联语法)
  let comment: string | undefined
  if (state.isKeyword('COMMENT')) {
    state.advance()
    if (state.current().type === TokenType.STRING) {
      comment = state.advance().value
    }
  }

  return { type, name, columns, using, comment }
}

/** 解析 CONSTRAINT name ... 约束 */
function parseNamedConstraint(state: ParserState): ParsedConstraint | null {
  state.advance() // CONSTRAINT
  let name: string | undefined
  if (state.isIdentOrKeyword()) {
    name = state.getIdentValue(state.advance())
  }

  const constraint = parseTableConstraint(state)
  if (constraint) {
    constraint.name = name || constraint.name
    return constraint
  }

  return null
}

// ===== COMMENT ON 语句解析 (PostgreSQL) =====

/** 解析完全限定名: [schema.]table */
function parseQualifiedName(state: ParserState): { schema?: string; table: string } {
  let first: string
  if (state.isIdentOrKeyword()) {
    first = state.getIdentValue(state.advance())
  } else {
    state.addError('Expected identifier in COMMENT ON', state.current())
    throw new Error('Expected identifier')
  }

  if (state.matchSymbol('.')) {
    const schema = first
    let second: string
    if (state.isIdentOrKeyword()) {
      second = state.getIdentValue(state.advance())
    } else {
      state.addError('Expected table name after dot', state.current())
      throw new Error('Expected table name')
    }
    return { schema, table: second }
  }

  return { table: first }
}

/** 解析完全限定列名: [schema.]table.column */
function parseQualifiedColumnName(state: ParserState): { schema?: string; table: string; column: string } {
  let first: string
  if (state.isIdentOrKeyword()) {
    first = state.getIdentValue(state.advance())
  } else {
    state.addError('Expected identifier in COMMENT ON COLUMN', state.current())
    throw new Error('Expected identifier')
  }

  if (state.matchSymbol('.')) {
    let second: string
    if (state.isIdentOrKeyword()) {
      second = state.getIdentValue(state.advance())
    } else {
      state.addError('Expected table name after dot', state.current())
      throw new Error('Expected table name')
    }

    if (state.matchSymbol('.')) {
      // schema.table.column
      let third: string
      if (state.isIdentOrKeyword()) {
        third = state.getIdentValue(state.advance())
      } else {
        state.addError('Expected column name after dot', state.current())
        throw new Error('Expected column name')
      }
      return { schema: first, table: second, column: third }
    }

    // table.column
    return { table: first, column: second }
  }

  // 只有列名（不太可能出现在 COMMENT ON COLUMN 中，但做容错处理）
  return { table: '', column: first }
}

/**
 * 解析独立的 COMMENT ON TABLE / COMMENT ON COLUMN 语句（PostgreSQL）
 * 将注释应用到已解析的 ParsedTable / ParsedColumn 上
 */
function parseCommentOnStatement(state: ParserState, tables: ParsedTable[]): void {
  state.advance() // COMMENT

  if (!state.matchKeyword('ON')) {
    state.skipToSemicolon()
    return
  }

  if (state.isKeyword('TABLE')) {
    state.advance() // TABLE
    try {
      const { schema, table: tableName } = parseQualifiedName(state)
      if (!state.matchKeyword('IS')) {
        state.addError("Expected 'IS' in COMMENT ON TABLE", state.current())
        state.skipToSemicolon()
        return
      }
      const commentStr = state.current().type === TokenType.STRING ? state.advance().value : undefined
      state.matchSymbol(';')

      if (commentStr !== undefined) {
        const targetTable = tables.find(t => {
          if (schema) return t.name === tableName && t.schema === schema
          return t.name === tableName
        })
        if (targetTable) {
          targetTable.comment = commentStr
        }
      }
    } catch {
      state.skipToSemicolon()
    }
  } else if (state.isKeyword('COLUMN')) {
    state.advance() // COLUMN
    try {
      const { schema, table: tableName, column: columnName } = parseQualifiedColumnName(state)
      if (!state.matchKeyword('IS')) {
        state.addError("Expected 'IS' in COMMENT ON COLUMN", state.current())
        state.skipToSemicolon()
        return
      }
      const commentStr = state.current().type === TokenType.STRING ? state.advance().value : undefined
      state.matchSymbol(';')

      if (commentStr !== undefined) {
        const targetTable = tables.find(t => {
          if (schema) return t.name === tableName && t.schema === schema
          return t.name === tableName
        })
        if (targetTable) {
          const targetCol = targetTable.columns.find(c => c.name === columnName)
          if (targetCol) {
            targetCol.comment = commentStr
          }
        }
      }
    } catch {
      state.skipToSemicolon()
    }
  } else if (state.isKeyword('INDEX')) {
    state.advance() // INDEX
    try {
      const { schema: idxSchema, table: idxName } = parseQualifiedName(state)
      if (!state.matchKeyword('IS')) {
        state.addError("Expected 'IS' in COMMENT ON INDEX", state.current())
        state.skipToSemicolon()
        return
      }
      const commentStr = state.current().type === TokenType.STRING ? state.advance().value : undefined
      state.matchSymbol(';')

      if (commentStr !== undefined) {
        // 在所有已解析的表中查找匹配的约束名
        for (const table of tables) {
          // 如果有 schema 限定，只匹配对应 schema 下的表
          if (idxSchema && table.schema !== idxSchema) continue
          const constraint = table.constraints.find(c => c.name === idxName)
          if (constraint) {
            constraint.comment = commentStr
            break
          }
        }
      }
    } catch {
      state.skipToSemicolon()
    }
  } else {
    // 不支持的 COMMENT ON 目标类型，跳过
    state.skipToSemicolon()
  }
}

// ===== 表选项解析 =====

function parseTableOptions(state: ParserState): ParsedTableOptions {
  const options: ParsedTableOptions = {}

  while (!state.isEOF()) {
    const t = state.current()
    if (t.type === TokenType.SYMBOL && t.value === ';') break
    if (t.type === TokenType.EOF) break

    // ENGINE = InnoDB
    if (state.isKeyword('ENGINE')) {
      state.advance()
      state.matchSymbol('=')
      options.engine = parseOptionValue(state)
      continue
    }

    // [DEFAULT] CHARACTER SET / CHARSET = utf8mb4
    if (state.isKeyword('DEFAULT_CHARSET', 'CHARACTER_SET')) {
      state.advance()
      state.matchSymbol('=')
      options.charset = parseOptionValue(state)
      continue
    }
    if (state.isKeyword('CHARSET')) {
      state.advance()
      state.matchSymbol('=')
      options.charset = parseOptionValue(state)
      continue
    }

    // [DEFAULT] COLLATE = utf8mb4_general_ci
    if (state.isKeyword('DEFAULT_COLLATE') || state.isKeyword('COLLATE')) {
      state.advance()
      state.matchSymbol('=')
      options.collation = parseOptionValue(state)
      continue
    }

    // AUTO_INCREMENT = 100
    if (state.isKeyword('AUTO_INCREMENT')) {
      state.advance()
      state.matchSymbol('=')
      if (state.current().type === TokenType.NUMBER) {
        options.autoIncrement = parseInt(state.advance().value, 10)
      }
      continue
    }

    // COMMENT = '...'
    if (state.isKeyword('COMMENT')) {
      state.advance()
      state.matchSymbol('=')
      if (state.current().type === TokenType.STRING) {
        options.comment = state.advance().value
      }
      continue
    }

    // ROW_FORMAT = Dynamic
    if (state.isKeyword('ROW_FORMAT')) {
      state.advance()
      state.matchSymbol('=')
      options.rowFormat = parseOptionValue(state)
      continue
    }

    // WITH OIDS (PostgreSQL, 跳过)
    if (state.isKeyword('WITH')) {
      state.advance()
      // 跳过 OIDS
      state.matchKeyword('OIDS')
      state.matchSymbol('=')
      if (state.isIdentOrKeyword()) state.advance()
      continue
    }

    // 其他未知选项 — 跳过
    // 尝试消费 "KEYWORD = value" 模式
    if (state.current().type === TokenType.KEYWORD) {
      const kw = state.advance().value
      if (state.matchSymbol('=')) {
        parseOptionValue(state)
      }
      continue
    }

    // 无法识别，跳出
    break
  }

  return options
}

/** 解析选项值（标识符、字符串、或关键字） */
function parseOptionValue(state: ParserState): string | undefined {
  const t = state.current()
  if (t.type === TokenType.IDENTIFIER || t.type === TokenType.KEYWORD) {
    return state.advance().value
  }
  if (t.type === TokenType.STRING) {
    return state.advance().value
  }
  if (t.type === TokenType.NUMBER) {
    return state.advance().value
  }
  return undefined
}
