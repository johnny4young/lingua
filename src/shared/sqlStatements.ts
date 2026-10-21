/**
 * Splits SQL into statements for the split Run (statement under the cursor,
 * run all, per-statement gutter buttons). It understands what can hide a
 * semicolon: single-quoted strings ('' escapes), E'' strings (backslash
 * escapes), double-quoted identifiers, -- line comments, nested block
 * comments, and dollar-quoted bodies ($$ or $tag$).
 */

export interface SqlStatement {
  /** Statement text without the trailing semicolon, trimmed of surrounding whitespace. */
  text: string;
  /** Offset of the first non-space character. */
  start: number;
  /** Offset just past the statement's semicolon, or its last character when there is none. */
  end: number;
  /** 1-based line of `start`. */
  startLine: number;
}

const DOLLAR_TAG = /\$([A-Za-z_\u0080-\uFFFF][A-Za-z0-9_\u0080-\uFFFF]*)?\$/y;
// DuckDB continues an identifier through `$` and any non-ASCII character.
const IDENTIFIER_CHAR = /[A-Za-z0-9_$\u0080-\uFFFF]/;

/** Offset where the token that starts at `index` ends, or -1 when it is not a quoted or comment token. */
function skipToken(sql: string, index: number): number {
  const ch = sql[index];
  const next = sql[index + 1];
  if (ch === '-' && next === '-') {
    // DuckDB ends a line comment at either line break character.
    let end = index + 2;
    while (end < sql.length && sql[end] !== '\n' && sql[end] !== '\r') end += 1;
    return end;
  }
  if (ch === '/' && next === '*') {
    let depth = 1;
    let i = index + 2;
    while (i < sql.length && depth > 0) {
      if (sql[i] === '/' && sql[i + 1] === '*') {
        depth += 1;
        i += 2;
      } else if (sql[i] === '*' && sql[i + 1] === '/') {
        depth -= 1;
        i += 2;
      } else {
        i += 1;
      }
    }
    return i;
  }
  if (ch === "'" || ((ch === 'E' || ch === 'e') && next === "'" && !IDENTIFIER_CHAR.test(sql[index - 1] ?? ''))) {
    const backslash = ch !== "'";
    let i = index + (backslash ? 2 : 1);
    while (i < sql.length) {
      if (backslash && sql[i] === '\\') {
        i += 2;
        continue;
      }
      if (sql[i] === "'") {
        if (sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        return i + 1;
      }
      i += 1;
    }
    return sql.length;
  }
  if (ch === '"') {
    let i = index + 1;
    while (i < sql.length) {
      if (sql[i] === '"') {
        if (sql[i + 1] === '"') {
          i += 2;
          continue;
        }
        return i + 1;
      }
      i += 1;
    }
    return sql.length;
  }
  if (ch === '$' && !IDENTIFIER_CHAR.test(sql[index - 1] ?? '')) {
    DOLLAR_TAG.lastIndex = index;
    const tag = DOLLAR_TAG.exec(sql)?.[0];
    if (tag) {
      const close = sql.indexOf(tag, index + tag.length);
      return close === -1 ? sql.length : close + tag.length;
    }
  }
  return -1;
}

/** True when the slice holds something other than whitespace and comments. */
function hasCode(sql: string, from: number, to: number): boolean {
  let i = from;
  while (i < to) {
    const ch = sql[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if ((ch === '-' && sql[i + 1] === '-') || (ch === '/' && sql[i + 1] === '*')) {
      i = Math.min(skipToken(sql, i), to);
      continue;
    }
    return true;
  }
  return false;
}

/** Statements in source order; comment-only and empty pieces are dropped. */
export function splitSqlStatements(sql: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  let pieceStart = 0;
  // Lines are counted forward from the previous statement, keeping the split linear.
  let line = 1;
  let lineOffset = 0;
  const close = (pieceEnd: number, end: number) => {
    if (!hasCode(sql, pieceStart, pieceEnd)) return;
    const raw = sql.slice(pieceStart, pieceEnd);
    const leading = raw.length - raw.trimStart().length;
    const start = pieceStart + leading;
    for (; lineOffset < start; lineOffset += 1) if (sql[lineOffset] === '\n') line += 1;
    statements.push({ text: raw.trim(), start, end, startLine: line });
  };
  let i = 0;
  while (i < sql.length) {
    const skipped = skipToken(sql, i);
    if (skipped !== -1) {
      i = skipped;
      continue;
    }
    if (sql[i] === ';') {
      close(i, i + 1);
      pieceStart = i + 1;
    }
    i += 1;
  }
  close(sql.length, sql.trimEnd().length);
  return statements;
}

/**
 * The statement the cursor belongs to: the one containing it, else the
 * nearest one before it (a cursor after `;` or on a blank line below), else
 * the first one after it.
 */
export function statementAtOffset(
  statements: ReadonlyArray<SqlStatement>,
  offset: number
): { statement: SqlStatement; index: number } | null {
  let previous = -1;
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index]!;
    if (offset >= statement.start && offset <= statement.end) return { statement, index };
    if (statement.end <= offset) previous = index;
  }
  if (previous !== -1) return { statement: statements[previous]!, index: previous };
  return statements[0] ? { statement: statements[0], index: 0 } : null;
}

const READ_LEAD = /^(select|from|values|table|with|summarize|describe|show|pivot|unpivot)\b/i;
const WRITE_WORD =
  /\b(insert|update|delete|merge|create|drop|alter|attach|detach|copy|truncate|rename|install|load|checkpoint|vacuum|set|reset|call|export|import|use)\b/i;

/** Blanks out strings, quoted identifiers and comments so keyword checks see only code. */
function codeOnly(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const skipped = skipToken(sql, i);
    if (skipped !== -1) {
      out += ' ';
      i = skipped;
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out.trim();
}

/**
 * True only for a statement that reads: it starts with a read keyword and
 * has no write keyword anywhere outside strings and comments. Explain
 * runs ANALYZE (which executes the statement) only when this holds.
 */
export function isReadOnlySqlStatement(statement: string): boolean {
  const code = codeOnly(statement);
  return READ_LEAD.test(code) && !WRITE_WORD.test(code);
}

const REMOTE_READ_LEAD = /^(select|with|values|table|show|describe|desc|explain)\b/i;

/**
 * True when a statement may change data or the session on a database
 * connection: anything that does not lead with a read keyword, a write word
 * anywhere in the code (a CTE that deletes, FOR UPDATE), SELECT … INTO, EXECUTE
 * of a prepared statement, or EXPLAIN ANALYZE (or ANALYSE), which runs it.
 */
export function isWriteSqlStatement(statement: string): boolean {
  // MySQL runs the inside of /*! … */ as code, and codeOnly reads it as a comment.
  if (statement.includes('/*!')) return true;
  const code = codeOnly(statement);
  if (!REMOTE_READ_LEAD.test(code)) return true;
  return (
    WRITE_WORD.test(code) ||
    /\b(into|execute)\b/i.test(code) ||
    /^explain\s*(\([\s\S]*\banaly[sz]e\b|analy[sz]e\b)/i.test(code)
  );
}

const ESTIMABLE_LEAD = /^(select|with|values|table|insert|update|delete|merge|replace)\b/i;

/**
 * True for one statement EXPLAIN can plan without running anything. The raw
 * text must start with a query or DML keyword, with no comment in front: the
 * engines disagree on where comments end (MySQL does not nest them), and a
 * comment there could turn `EXPLAIN …` into `EXPLAIN ANALYZE …`. A MySQL
 * executable comment anywhere is refused, since MySQL runs it as code.
 */
export function isEstimableSqlStatement(statement: string): boolean {
  if (statement.includes('/*!')) return false;
  return splitSqlStatements(statement).length === 1 && ESTIMABLE_LEAD.test(statement.trimStart());
}

// Settings can carry credentials under any name (connection strings included), so every SET, RESET or PRAGMA is masked.
const SECRET_STATEMENT = /\b(secret|attach)\b|^\s*(set|reset|pragma)\b/i;
const SECRET_LITERAL =
  /:\/\/[^\s'/]*@|[?&;](token|key|sig|signature|password|access_token|accountkey|sharedaccesssignature|x-amz-[a-z-]+)=/i;

/**
 * Masks string literals that may hold credentials before SQL is kept in the
 * run History: every literal of a SECRET, ATTACH, SET, RESET or PRAGMA statement,
 * and any URL literal with user info or a token-like query parameter.
 */
export function redactSqlSecrets(sql: string): string {
  const secretStatement = SECRET_STATEMENT.test(codeOnly(sql));
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const end = skipToken(sql, i);
    if (end === -1) {
      out += sql[i];
      i += 1;
      continue;
    }
    const token = sql.slice(i, end);
    const ch = sql[i];
    const isLiteral = ch === "'" || ch === '$' || ((ch === 'E' || ch === 'e') && sql[i + 1] === "'");
    out += isLiteral && (secretStatement || SECRET_LITERAL.test(token)) ? "'•••'" : token;
    i = end;
  }
  return out;
}

/** True when the code (outside strings and comments) already has a WHERE clause. */
export function hasWhereClause(sql: string): boolean {
  return /\bwhere\b/i.test(codeOnly(sql));
}
