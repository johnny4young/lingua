/**
 * Instant SQL: which part of the statement under the cursor to preview (a CTE
 * of its WITH chain, or the whole result), the sampled SQL that shows it, and
 * why a statement must not run as you type.
 */

import { isReadOnlySqlStatement, skipSqlToken, splitSqlStatements, sqlCodeOnly, statementAtOffset } from './sqlStatements';

export const INSTANT_SAMPLE_ROWS = 1000;

interface Token {
  kind: 'ident' | 'string' | 'punct';
  /** Identifier text without quotes, the raw text otherwise. */
  text: string;
  start: number;
  end: number;
  bare: boolean;
}

const WORD = /[A-Za-z_\u0080-￿][A-Za-z0-9_$\u0080-￿]*/y;

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    const skipped = skipSqlToken(sql, i);
    if (skipped !== -1) {
      if (ch === '"') tokens.push({ kind: 'ident', text: sql.slice(i + 1, skipped - 1).replaceAll('""', '"'), start: i, end: skipped, bare: false });
      else if (!((ch === '-' && sql[i + 1] === '-') || (ch === '/' && sql[i + 1] === '*'))) {
        tokens.push({ kind: 'string', text: sql.slice(i, skipped), start: i, end: skipped, bare: false });
      }
      i = skipped;
      continue;
    }
    WORD.lastIndex = i;
    const word = WORD.exec(sql)?.[0];
    if (word) {
      tokens.push({ kind: 'ident', text: word, start: i, end: i + word.length, bare: true });
      i += word.length;
      continue;
    }
    tokens.push({ kind: 'punct', text: ch, start: i, end: i + 1, bare: false });
    i += 1;
  }
  return tokens;
}

const isWord = (token: Token | undefined, word: string) => token?.bare === true && token.text.toLowerCase() === word;
const isPunct = (token: Token | undefined, punct: string) => token?.kind === 'punct' && token.text === punct;
// DuckDB matches identifiers case-insensitively, quoted or not.
const keyOf = (token: Token) => token.text.toLowerCase();

export interface SqlCte {
  /** Lower-cased name, how references match it. */
  key: string;
  /** The name as written, quotes included, for building SQL. */
  ref: string;
  /** The name to show. */
  label: string;
  /** Offset of the name in the statement. */
  start: number;
  /** Offset just past the body's closing parenthesis. */
  end: number;
  /** Keys of earlier CTEs the body reads. */
  dependsOn: string[];
}

export interface SqlCteChain {
  ctes: SqlCte[];
  /** Offset of the query after the WITH clause. */
  mainStart: number;
  mainDependsOn: string[];
}

/** The WITH chain of one statement, or null when it has none or is still being typed. */
export function parseCteChain(statement: string): SqlCteChain | null {
  const tokens = tokenize(statement);
  if (!isWord(tokens[0], 'with')) return null;
  const closes = new Map<number, number>();
  const open: number[] = [];
  tokens.forEach((token, index) => {
    if (isPunct(token, '(')) open.push(index);
    else if (isPunct(token, ')') && open.length > 0) closes.set(open.pop()!, index);
  });
  const referenced = (from: number, to: number, keys: ReadonlySet<string>) => {
    const found = new Set<string>();
    for (let index = from; index < to; index += 1) {
      const token = tokens[index]!;
      if (token.kind === 'ident' && keys.has(keyOf(token))) found.add(keyOf(token));
    }
    return [...found];
  };
  const ctes: SqlCte[] = [];
  let k = isWord(tokens[1], 'recursive') ? 2 : 1;
  for (;;) {
    const name = tokens[k];
    if (name?.kind !== 'ident') return null;
    k += 1;
    if (isPunct(tokens[k], '(')) {
      const close = closes.get(k);
      if (close === undefined) return null;
      k = close + 1;
    }
    if (!isWord(tokens[k], 'as')) return null;
    k += 1;
    while (isWord(tokens[k], 'not') || isWord(tokens[k], 'materialized')) k += 1;
    const close = isPunct(tokens[k], '(') ? closes.get(k) : undefined;
    if (close === undefined) return null;
    const earlier = new Set(ctes.map((cte) => cte.key));
    ctes.push({
      key: keyOf(name),
      ref: statement.slice(name.start, name.end),
      label: name.text,
      start: name.start,
      end: tokens[close]!.end,
      dependsOn: referenced(k + 1, close, earlier),
    });
    k = close + 1;
    if (!isPunct(tokens[k], ',')) break;
    k += 1;
  }
  return {
    ctes,
    mainStart: tokens[k]?.start ?? statement.length,
    mainDependsOn: referenced(k, tokens.length, new Set(ctes.map((cte) => cte.key))),
  };
}

/** CTEs after `key` that read it directly or through another CTE, and whether the main query does. */
export function cteDependents(chain: SqlCteChain, key: string): { ctes: Set<string>; main: boolean } {
  const reached = new Set([key]);
  const ctes = new Set<string>();
  for (const cte of chain.ctes) {
    if (cte.key !== key && cte.dependsOn.some((dep) => reached.has(dep))) {
      reached.add(cte.key);
      ctes.add(cte.key);
    }
  }
  return { ctes, main: chain.mainDependsOn.some((dep) => reached.has(dep)) };
}

export type InstantBlockReason = 'write' | 'remote' | 'side-effect';

export interface InstantCrumb {
  /** The CTE's key; empty for the statement's result. */
  key: string;
  label?: string;
  /** Buffer offset to move the cursor to. */
  offset: number;
  active: boolean;
  dependent: boolean;
}

export interface InstantPreviewPlan {
  /** Stays the same while the cursor stays on the same target of the same statement. */
  targetKey: string;
  /** Label of the CTE shown; unset when the preview shows the statement's result. */
  cte?: string;
  /** Buffer offsets of the CTE shown. */
  range?: { start: number; end: number };
  crumbs: InstantCrumb[];
  sql?: string;
  blocked?: InstantBlockReason;
}

// Remote reads would fetch on every keystroke.
const REMOTE_URL = /\b(?:https?|s3[an]?|gcs|gs|r2|azure?|abfss|hf):\/\//i;
const SIDE_EFFECT_CALL = /\b(?:nextval|setval|setseed|query|query_table)\s*\(/i;

/** What the preview shows for the cursor at `offset` of `buffer`, or null when there is no statement. */
export function planInstantPreview(buffer: string, offset: number): InstantPreviewPlan | null {
  const picked = statementAtOffset(splitSqlStatements(buffer), offset);
  if (!picked) return null;
  const { text, start } = picked.statement;
  const blocked: InstantBlockReason | undefined = !isReadOnlySqlStatement(text)
    ? 'write'
    : REMOTE_URL.test(text)
      ? 'remote'
      : SIDE_EFFECT_CALL.test(sqlCodeOnly(text))
        ? 'side-effect'
        : undefined;
  if (blocked) return { targetKey: `${picked.index}:${blocked}`, crumbs: [], blocked };
  const chain = parseCteChain(text);
  const relative = offset - start;
  const cte = chain?.ctes.find((candidate) => relative >= candidate.start && relative <= candidate.end);
  const dependents = chain && cte ? cteDependents(chain, cte.key) : null;
  const crumbs: InstantCrumb[] = chain
    ? [
        ...chain.ctes.map((candidate) => ({
          key: candidate.key,
          label: candidate.label,
          offset: start + candidate.start,
          active: candidate === cte,
          dependent: dependents?.ctes.has(candidate.key) ?? false,
        })),
        { key: '', offset: start + chain.mainStart, active: !cte, dependent: dependents?.main ?? false },
      ]
    : [];
  return {
    targetKey: `${picked.index}:${cte?.key ?? ''}`,
    crumbs,
    ...(cte
      ? {
          cte: cte.label,
          range: { start: start + cte.start, end: start + cte.end },
          sql: `${text.slice(0, cte.end)}\nSELECT * FROM ${cte.ref} LIMIT ${INSTANT_SAMPLE_ROWS}`,
        }
      : { sql: `SELECT * FROM (\n${text}\n) AS lingua_instant LIMIT ${INSTANT_SAMPLE_ROWS}` }),
  };
}
