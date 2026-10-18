/**
 * CREATE TABLE recursive descent parser
 *
 * Parses a Token stream into the ParsedTable intermediate representation.
 * Supports CREATE TABLE syntax for the MySQL, PostgreSQL and SQLite dialects
 * (SQLite-specific syntax such as PRAGMA / AUTOINCREMENT / WITHOUT ROWID is used only for dialect detection and does not participate in structural parsing).
 */

import { lex, type Token, TokenType } from './tokenizer'

// ===== Intermediate representation types =====

/** Parsed column definition */
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
  /** Whether ON UPDATE CURRENT_TIMESTAMP is present (MySQL) */
  onUpdateCurrentTimestamp: boolean
  /** Fractional-seconds precision of ON UPDATE CURRENT_TIMESTAMP; null when there are no parentheses */
  onUpdateCurrentTimestampPrecision?: number | null
}

/** Parsed constraint (table-level) */
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

/** Table options */
export interface ParsedTableOptions {
  engine?: string
  charset?: string
  collation?: string
  autoIncrement?: number
  comment?: string
  rowFormat?: string
}

/** Fully parsed table definition */
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

/** Parse error/warning */
export interface ParseMessage {
  type: 'error' | 'warning'
  message: string
  line: number
  column: number
  tableName?: string
}

/** Top-level parse result */
export interface ParseResult {
  tables: ParsedTable[]
  messages: ParseMessage[]
}

// ===== Parser state =====

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

  /** Checks whether the current token is an identifier or keyword */
  isIdentOrKeyword(): boolean {
    const t = this.current()
    return t?.type === TokenType.IDENTIFIER ||
      t?.type === TokenType.BACKTICK_ID ||
      t?.type === TokenType.DOUBLEQUOTE_ID ||
      t?.type === TokenType.KEYWORD
  }

  /** Gets the identifier name (handles various quoting styles and keywords) */
  getIdentValue(t: Token): string {
    if (t.type === TokenType.IDENTIFIER || t.type === TokenType.KEYWORD) {
      return t.value
    }
    if (t.type === TokenType.BACKTICK_ID || t.type === TokenType.DOUBLEQUOTE_ID) {
      return t.value
    }
    return t.value
  }

  /** Checks the current token's value (case-insensitive) */
  isKeyword(...words: string[]): boolean {
    const t = this.current()
    if (!t) return false
    if (t.type !== TokenType.KEYWORD) return false
    return words.some(w => t.value === w)
  }

  /** Consumes a token and checks whether it matches */
  matchKeyword(...words: string[]): Token | null {
    if (this.isKeyword(...words)) {
      return this.advance()
    }
    return null
  }

  /** Consumes a symbol token */
  matchSymbol(sym: string): boolean {
    const t = this.current()
    if (t?.type === TokenType.SYMBOL && t.value === sym) {
      this.advance()
      return true
    }
    return false
  }

  /** Skips ahead until a semicolon or EOF is reached */
  skipToSemicolon(): void {
    while (!this.isEOF()) {
      const t = this.advance()
      if (t.type === TokenType.SYMBOL && t.value === ';') break
    }
  }

  /** Skips ahead until one of the given symbols is reached */
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

// ===== Main parse entry point =====

/**
 * Parses CREATE TABLE statements from SQL text
 */
export function parseCreateTableStatements(input: string): ParseResult {
  const tokens = lex(input)
  const state = new ParserState(tokens)

  const tables: ParsedTable[] = []

  while (!state.isEOF()) {
    // Skip comments
    while (!state.isEOF() &&
      (state.current().type === TokenType.COMMENT_LINE ||
        state.current().type === TokenType.COMMENT_BLOCK)) {
      state.advance()
    }

    if (state.isEOF()) break

    // Handle COMMENT ON TABLE / COMMENT ON COLUMN (PostgreSQL)
    if (state.isKeyword('COMMENT')) {
      parseCommentOnStatement(state, tables)
    }
    // Look for CREATE TABLE
    else if (state.isKeyword('CREATE')) {
      const _createToken = state.advance() // CREATE

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
          // If parsing fails, try to skip to the next statement
          state.skipToSemicolon()
        }
      } else if (state.isKeyword('SCHEMA')) {
        // CREATE SCHEMA — skip
        state.skipToSemicolon()
      } else {
        // Other CREATE statements — skip
        state.skipToSemicolon()
      }
    } else {
      // Non-CREATE statement, skip to the next one
      state.skipToSemicolon()
    }
  }

  return { tables, messages: state.messages }
}

// ===== CREATE TABLE body parsing =====

function parseCreateTableBody(state: ParserState): ParsedTable {
  // IF NOT EXISTS
  const ifNotExists = !!state.matchKeyword('IF_NOT_EXISTS')

  // Table name (supports the schema.table form)
  const nameToken = state.current()
  if (!state.isIdentOrKeyword()) {
    state.addError('Expected table name', nameToken)
    throw new Error('Expected table name')
  }

  let tableName: string
  let schemaName: string | undefined

  const first = state.getIdentValue(state.advance())

  // Check for the schema.table form (schema.name)
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

  // Check for LIKE / AS SELECT subqueries (skipped, not parsed)
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

  // Check for INHERITS (PostgreSQL)
  if (state.isKeyword('INHERITS')) {
    state.advance()
    state.skipUntil(';')
    // Skip the parenthesized content of the INHERITS clause
    if (state.matchSymbol('(')) {
      let depth = 1
      while (!state.isEOF() && depth > 0) {
        const t = state.advance()
        if (t.type === TokenType.SYMBOL && t.value === '(') depth++
        if (t.type === TokenType.SYMBOL && t.value === ')') depth--
      }
    }
  }

  // Expect '(' to start the column definitions
  if (!state.matchSymbol('(')) {
    state.addError("Expected '(' after table name", state.current())
    throw new Error("Expected '('")
  }

  // Parse column definitions and table-level constraints
  const columns: ParsedColumn[] = []
  const constraints: ParsedConstraint[] = []

  parseTableBody(state, columns, constraints)

  // Expect ')' to close
  if (!state.matchSymbol(')')) {
    state.addError("Expected ')' to close column definitions", state.current())
    // Try to recover: skip until )
    state.skipUntil(')', ';')
    state.matchSymbol(')')
  }

  // Parse table options
  const options = parseTableOptions(state)

  // Expect ';'
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

// ===== Table body parsing (column definitions + constraints) =====

function parseTableBody(
  state: ParserState,
  columns: ParsedColumn[],
  constraints: ParsedConstraint[],
): void {
  while (!state.isEOF()) {
    // Skip comments
    while (!state.isEOF() &&
      (state.current().type === TokenType.COMMENT_LINE ||
        state.current().type === TokenType.COMMENT_BLOCK)) {
      state.advance()
    }

    // Termination conditions
    const t = state.current()
    if (t.type === TokenType.SYMBOL && t.value === ')') break
    if (t.type === TokenType.EOF) break

    // Check whether an inline comment marks this field as commented out
    // (by checking whether the previous token is COMMENT_LINE)
    // In practice we detect this by checking for a -- prefix before the field definition

    // Try to parse a column definition or constraint
    const savedPos = state.pos
    const savedMsgs = state.messages.length

    // First try to parse it as CONSTRAINT name ...
    if (state.isKeyword('CONSTRAINT')) {
      const constraint = parseNamedConstraint(state)
      if (constraint) {
        constraints.push(constraint)
        state.matchSymbol(',')
        continue
      }
    }

    // Try to parse it as a table-level constraint (PRIMARY KEY, UNIQUE, INDEX, KEY, FULLTEXT, SPATIAL)
    if (isTableConstraintStart(state)) {
      const constraint = parseTableConstraint(state)
      if (constraint) {
        constraints.push(constraint)
        state.matchSymbol(',')
        continue
      }
    }

    // Backtrack and try to parse a column definition
    state.pos = savedPos
    state.messages.length = savedMsgs

    // Check whether this is a commented-out field (the previous token is COMMENT_LINE and its content starts with --, which is likely commented out)
    // For is_commented_out fields, we still parse them but mark them as commented out
    // Line comments are already stripped during tokenization, so we would need another way to detect this
    // Simplified approach: parse it as a normal column first

    const column = parseColumnDef(state)
    if (column) {
      columns.push(column)
      state.matchSymbol(',')
      continue
    }

    // Unrecognized, skip to , or )
    state.addWarning('Skipping unrecognized element in table body', state.current())
    state.skipUntil(',', ')')
    state.matchSymbol(',')
  }
}

// ===== Column definition parsing =====

function parseColumnDef(state: ParserState): ParsedColumn | null {
  const _startToken = state.current()

  // Read the column name
  if (!state.isIdentOrKeyword()) {
    return null
  }
  const name = state.getIdentValue(state.advance())

  // Read the type name
  let rawType = ''
  let length: number | null = null
  let scale: number | null = null

  // Handle the PostgreSQL DOUBLE PRECISION composite type
  if (state.isKeyword('DOUBLE_PRECISION')) {
    rawType = state.advance().value
  }
  // Handle PostgreSQL CHARACTER VARYING
  else if (state.isKeyword('CHARACTER')) {
    state.advance()
    if (state.isKeyword('VARYING')) {
      state.advance()
      rawType = 'CHARACTER VARYING'
    } else {
      rawType = 'CHARACTER'
    }
  }
  // Handle PostgreSQL TIMESTAMP WITH/WITHOUT TIME ZONE
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
  // Handle the PostgreSQL cast operator ::
  else if (state.current().type === TokenType.SYMBOL && state.current().value === '::') {
    // The type was already parsed as an identifier earlier; this is just a cast: column::type
    // This is uncommon in CREATE TABLE, so skip it
    return null
  }
  // Plain type name
  else if (state.isIdentOrKeyword()) {
    rawType = state.getIdentValue(state.advance())
  } else {
    state.addError(`Expected type for column "${name}"`, state.current())
    return null
  }

  // Handle the PostgreSQL ARRAY type suffix
  if (state.matchSymbol('[') && state.matchSymbol(']')) {
    rawType += '[]'
  }

  // Type arguments: VARCHAR(255), DECIMAL(10,2), ENUM('a','b')
  if (state.matchSymbol('(')) {
    // Check whether this is a string list for ENUM/SET
    if (state.current().type === TokenType.STRING) {
      // ENUM('a','b','c') — collect all values without expanding them
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
      // Numeric arguments: VARCHAR(255), DECIMAL(10,2)
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

  // Column constraint parsing
  let notNull = false
  let autoIncrement = false
  let unique = false
  let primaryKey = false
  let defaultValue: string | undefined
  let comment: string | undefined
  let generatedIdentity: 'ALWAYS' | 'BY_DEFAULT' | undefined
  let unsigned = false
  let onUpdateCurrentTimestamp = false
  let onUpdateCurrentTimestampPrecision: number | null = null

  // Loop over column constraints (until , or ) is reached)
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
      // May be followed by KEY
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
      // Skip SET if it has not been consumed yet
      state.matchKeyword('SET')
      // Skip the charset name
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

    // ON UPDATE CURRENT_TIMESTAMP[(n)]
    if (state.isKeyword('ON_UPDATE')) {
      state.advance()
      if (state.isKeyword('CURRENT_TIMESTAMP') || state.isKeyword('NOW')) {
        state.advance()
        onUpdateCurrentTimestamp = true
        onUpdateCurrentTimestampPrecision = parsePrecisionArg(state)
      } else {
        // Expressions other than CURRENT_TIMESTAMP (e.g. ON UPDATE NOW()) are not modeled yet; skip them
        state.addWarning(`Unsupported ON UPDATE expression: "${state.current().value}"`, state.current())
        skipBalancedParens(state)
      }
      continue
    }

    // REFERENCES (foreign key — skip)
    if (state.isKeyword('REFERENCES')) {
      state.advance()
      // Skip the referenced table name
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

    // CHECK (skip)
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

    // Unrecognized constraint — skip
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
    onUpdateCurrentTimestamp,
    onUpdateCurrentTimestampPrecision,
  }
}

/** If the current token is '(', skips the whole parenthesized segment (supports nesting) */
function skipBalancedParens(state: ParserState): void {
  if (!state.matchSymbol('(')) return
  let depth = 1
  while (!state.isEOF() && depth > 0) {
    const tt = state.advance()
    if (tt.type === TokenType.SYMBOL && tt.value === '(') depth++
    if (tt.type === TokenType.SYMBOL && tt.value === ')') depth--
  }
}

/** Parses an optional parenthesized precision argument, e.g. `(3)` -> 3; returns null when there are no parentheses or the value is not numeric */
function parsePrecisionArg(state: ParserState): number | null {
  if (!state.matchSymbol('(')) return null
  const precision = state.current().type === TokenType.NUMBER ? Number(state.advance().value) : null
  while (!state.isEOF() && !state.matchSymbol(')')) {
    state.advance()
  }
  return precision
}

/** Parses a DEFAULT value */
function parseDefaultValue(state: ParserState): string | undefined {
  const t = state.current()

  // String value
  if (t.type === TokenType.STRING) {
    return `'${state.advance().value}'`
  }

  // Number
  if (t.type === TokenType.NUMBER) {
    return state.advance().value
  }

  // Keywords: NULL, CURRENT_TIMESTAMP, NOW(), TRUE, FALSE
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
      // May carry a parenthesized argument such as CURRENT_TIMESTAMP(3)
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
    // Other keywords/functions are stored as strings
    state.advance()
    return kw
  }

  // Symbols (e.g. the minus sign of -1)
  if (t.type === TokenType.SYMBOL && t.value === '-') {
    state.advance()
    if (state.current().type === TokenType.NUMBER) {
      return '-' + state.advance().value
    }
    return '-'
  }

  return undefined
}

// ===== Table-level constraint detection and parsing =====

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
    // UNIQUE KEY or UNIQUE INDEX
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

  // Optional index name
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

  // Column list (col1, col2, ...)
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

      // Optional sort direction
      if (state.isKeyword('ASC')) {
        state.advance()
        sortOrder = 'ASC'
      } else if (state.isKeyword('DESC')) {
        state.advance()
        sortOrder = 'DESC'
      }

      // Optional length (for index prefixes, MySQL)
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

  // Optional USING (after the column list)
  if (!using && state.isKeyword('USING')) {
    state.advance()
    if (state.isIdentOrKeyword()) {
      using = state.getIdentValue(state.advance())
    }
  }

  // Optional COMMENT '...' (MySQL inline syntax)
  let comment: string | undefined
  if (state.isKeyword('COMMENT')) {
    state.advance()
    if (state.current().type === TokenType.STRING) {
      comment = state.advance().value
    }
  }

  return { type, name, columns, using, comment }
}

/** Parses a CONSTRAINT name ... constraint */
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

// ===== COMMENT ON statement parsing (PostgreSQL) =====

/** Parses a fully qualified name: [schema.]table */
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

/** Parses a fully qualified column name: [schema.]table.column */
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

  // Column name only (unlikely in COMMENT ON COLUMN, but handled for robustness)
  return { table: '', column: first }
}

/**
 * Parses standalone COMMENT ON TABLE / COMMENT ON COLUMN statements (PostgreSQL)
 * and applies the comments to the already parsed ParsedTable / ParsedColumn
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
        // Look for the matching constraint name across all parsed tables
        for (const table of tables) {
          // If schema-qualified, only match tables in that schema
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
    // Unsupported COMMENT ON target type, skip
    state.skipToSemicolon()
  }
}

// ===== Table option parsing =====

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

    // WITH OIDS (PostgreSQL, skip)
    if (state.isKeyword('WITH')) {
      state.advance()
      // Skip OIDS
      state.matchKeyword('OIDS')
      state.matchSymbol('=')
      if (state.isIdentOrKeyword()) state.advance()
      continue
    }

    // Other unknown options — skip
    // Try to consume the "KEYWORD = value" pattern
    if (state.current().type === TokenType.KEYWORD) {
      const _kw = state.advance().value
      if (state.matchSymbol('=')) {
        parseOptionValue(state)
      }
      continue
    }

    // Unrecognized, break out
    break
  }

  return options
}

/** Parses an option value (identifier, string, or keyword) */
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
