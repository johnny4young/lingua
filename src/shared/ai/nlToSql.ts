/**
 * implementation follow-on — natural-language → SQL request builder (pure core).
 *
 * The SQL workspace already knows the live DuckDB schema (the single
 * `information_schema.columns` probe that feeds the browser + autocomplete).
 * This builds a chat request whose ONLY context is that schema — table and
 * column names + SQL types. **No rows, no data values, ever** — the schema
 * is the entire payload, and the consent preview shows it verbatim so the
 * user can verify exactly that before sending.
 *
 * Same posture as `explainError.ts`: pure, no network, bounded sizes; the
 * caller sends only after the user approves the preview.
 */

import type { ChatMessage } from './explainError';

/** Max characters of the user question included in the prompt. */
export const MAX_NLSQL_QUESTION_CHARS = 1000;
/** Max characters of the schema text included in the prompt. */
export const MAX_NLSQL_SCHEMA_CHARS = 6000;

/** Minimal schema shape — matches the SQL workspace's browser state. */
export interface NlToSqlTable {
  readonly name: string;
  readonly columns?: ReadonlyArray<{
    readonly name: string;
    readonly type: string;
  }>;
}

/**
 * Render the discovered tables as one `name(col TYPE, …)` line each — the
 * exact text that goes to the model AND into the consent preview.
 */
export function formatSchemaForPrompt(
  tables: ReadonlyArray<NlToSqlTable>
): string {
  if (tables.length === 0) return '(no tables in the session)';
  return tables
    .map((table) => {
      const cols = table.columns
        ?.map((c) => `${c.name} ${c.type}`)
        .join(', ');
      return cols && cols.length > 0 ? `${table.name}(${cols})` : table.name;
    })
    .join('\n');
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n… [truncated]`;
}

export interface NlToSqlInput {
  /** The natural-language request (e.g. "top 5 customers by total"). */
  readonly question: string;
  /** Schema text from `formatSchemaForPrompt`. */
  readonly schemaText: string;
  /** Optional model id, passed through to the provider. */
  readonly model?: string;
}

export interface NlToSqlRequest {
  readonly model?: string;
  readonly messages: readonly ChatMessage[];
  /** Human-readable rendering of EXACTLY what would leave the device. */
  readonly preview: string;
}

const SYSTEM_PROMPT =
  'You are a DuckDB SQL expert embedded in a local SQL workspace. Write ONE ' +
  'SQL query that satisfies the user request, using ONLY the tables and ' +
  'columns in the provided schema — never invent names. Reply with a single ' +
  'fenced sql code block plus at most two short sentences. Use the DuckDB ' +
  'dialect. Prefer SELECT; write DDL/DML only when the user explicitly asks ' +
  'for it.';

/**
 * Build the NL→SQL request plus its consent preview. Pure — no network.
 */
export function buildNlToSqlRequest(input: NlToSqlInput): NlToSqlRequest {
  const question = clip(input.question.trim(), MAX_NLSQL_QUESTION_CHARS);
  const schemaText = clip(input.schemaText, MAX_NLSQL_SCHEMA_CHARS);

  const userContent = `Schema:\n${schemaText}\n\nRequest: ${question}`;

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  const preview =
    'The following will be sent to your configured AI endpoint:\n\n' +
    messages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n');

  const request: NlToSqlRequest = { messages, preview };
  return input.model ? { ...request, model: input.model } : request;
}
