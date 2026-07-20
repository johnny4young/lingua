/**
 * implementation detail — "Explain selected code" request builder (pure core).
 *
 * The sibling of `explainError.ts`, but for the MAIN editor: instead of
 * explaining a run error, it explains a code excerpt (a selection, or
 * the whole buffer when nothing is selected). Same privacy contract —
 * obvious secrets are redacted, the excerpt is bounded, and the builder
 * returns a verbatim `preview` of exactly what would leave the device so
 * the consent surface can show it before anything is sent. Performs no
 * network I/O.
 */

import {
  MAX_EXPLAIN_CODE_CHARS,
  redactSecretsFromCode,
  type ChatMessage,
} from './explainError';

/** Max characters of a user's free-text question included in the prompt. */
export const MAX_EXPLAIN_CODE_QUESTION_CHARS = 500;

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n… [truncated]`;
}

export interface ExplainCodeInput {
  /** The code excerpt to explain (selection or whole buffer). */
  readonly code: string;
  /** Language id (e.g. `python`, `javascript`). */
  readonly language: string;
  /** Optional file name for context. */
  readonly filename?: string;
  /**
   * Optional free-text question. When omitted the assistant is asked to
   * explain what the code does; when present it answers that instead.
   */
  readonly question?: string;
  /** Redact obvious secrets before building the request. Defaults to true. */
  readonly redact?: boolean;
  /** Optional model id to request (provider-specific). */
  readonly model?: string;
}

export interface ExplainCodeRequest {
  readonly model?: string;
  readonly messages: readonly ChatMessage[];
  /** Verbatim rendering of EXACTLY what would leave the device. */
  readonly preview: string;
  /** True when redaction masked at least one secret in the excerpt. */
  readonly redacted: boolean;
  /** How many secrets redaction masked; 0 when nothing was masked. */
  readonly redactedCount: number;
}

const SYSTEM_PROMPT =
  'You are a concise programming assistant embedded in a code editor. ' +
  'Explain what the provided code does, clearly and briefly, and point out ' +
  'anything surprising or risky. Base your answer only on the code the user ' +
  'shared — do not invent code they did not share, and do not ask for their ' +
  'API keys or secrets. If the user asks a specific question, answer it directly.';

/**
 * Build the provider-agnostic "explain this code" request plus the consent
 * preview. Pure — no network. The caller sends only after the user approves.
 */
export function buildExplainCodeRequest(
  input: ExplainCodeInput
): ExplainCodeRequest {
  const redact = input.redact !== false;
  const redaction = redact
    ? redactSecretsFromCode(input.code)
    : { code: input.code, redactedCount: 0 };

  const code = clip(redaction.code, MAX_EXPLAIN_CODE_CHARS);
  const fileLabel = input.filename ? ` (${input.filename})` : '';
  const question = input.question?.trim();
  const askLine = question
    ? `Question: ${clip(question, MAX_EXPLAIN_CODE_QUESTION_CHARS)}\n`
    : 'Explain what this code does.\n';

  const userContent =
    `Language: ${input.language}${fileLabel}\n` +
    askLine +
    `\nCode:\n\`\`\`${input.language}\n${code}\n\`\`\``;

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  const preview =
    'The following will be sent to your configured AI endpoint:\n\n' +
    messages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n');

  const request: ExplainCodeRequest = {
    messages,
    preview,
    redacted: redaction.redactedCount > 0,
    redactedCount: redaction.redactedCount,
  };
  return input.model ? { ...request, model: input.model } : request;
}
