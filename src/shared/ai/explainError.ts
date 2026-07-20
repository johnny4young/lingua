/**
 * implementation — "Explain this error" request builder (pure core).
 *
 * Per `docs/LOCAL_AI_ADR.md`, the first AI feature is opt-in error
 * explanation over a BYO-API-key, OpenAI-compatible `/chat/completions`
 * endpoint. This module builds the request AND a human-readable **preview**
 * of exactly what would leave the device, so the consent surface can show the
 * user the payload before anything is sent. It performs **no network I/O** —
 * the provider client + UI are following slices, gated on ADR sign-off.
 *
 * Privacy posture (the "no silent network call" brand principle):
 *   - Obvious secrets in the code excerpt are redacted before the preview is
 *     even built (defense in depth; the preview is the real control).
 *   - The excerpt + error text are bounded so a giant buffer can't be sent by
 *     accident.
 *   - Nothing here reaches the wire; a later work does the POST, only on an
 *     explicit user action.
 */

import { looksSecret } from '../httpEnvironment';

/** Max characters of code context included in the prompt. */
export const MAX_EXPLAIN_CODE_CHARS = 4000;
/** Max characters of the error message included in the prompt. */
export const MAX_EXPLAIN_ERROR_CHARS = 2000;

const REDACTED = '<redacted>';

/**
 * High-confidence, name-independent secret token shapes. These are redacted
 * anywhere they appear (not just in assignments) because their format alone
 * identifies them as a credential.
 */
const TOKEN_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI-style
  /sk-ant-[A-Za-z0-9_-]{16,}/g, // Anthropic
  /ghp_[A-Za-z0-9]{20,}/g, // GitHub PAT
  /gho_[A-Za-z0-9]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /AIza[0-9A-Za-z_-]{30,}/g, // Google API key
];

/** An assignment of a quoted string to an identifier: `NAME = "value"` / `NAME: 'value'`. */
const SECRET_ASSIGN =
  /^(\s*(?:const |let |var |export\s+(?:const |let |var )?)?)([A-Za-z_$][\w$.]*)(\s*[:=]\s*)(["'])(.*?)\4/;

export interface RedactionResult {
  readonly code: string;
  /** Number of values masked. */
  readonly redactedCount: number;
}

/**
 * Mask obvious secrets in a code excerpt before it is previewed or sent:
 *   1. A quoted string assigned to a secret-looking identifier
 *      (`API_KEY = "…"`, `password: '…'`) — via the shared `looksSecret`
 *      name heuristic.
 *   2. Any token-shaped value (`sk-…`, `ghp_…`, `AKIA…`) anywhere.
 * Pure; never throws.
 */
export function redactSecretsFromCode(code: string): RedactionResult {
  let redactedCount = 0;

  const byLine = code.split(/\r?\n/u).map((line) => {
    const match = SECRET_ASSIGN.exec(line);
    if (match && looksSecret(match[2]!) && match[5]!.length > 0) {
      redactedCount += 1;
      return `${match[1]}${match[2]}${match[3]}${match[4]}${REDACTED}${match[4]}`;
    }
    return line;
  });

  let out = byLine.join('\n');
  for (const pattern of TOKEN_PATTERNS) {
    out = out.replace(pattern, () => {
      redactedCount += 1;
      return REDACTED;
    });
  }
  return { code: out, redactedCount };
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n… [truncated]`;
}

export interface ExplainErrorInput {
  /** The error message / traceback the run produced. */
  readonly errorMessage: string;
  /** The code excerpt to include as context. */
  readonly code: string;
  /** Language id (e.g. `python`, `javascript`). */
  readonly language: string;
  /** Optional file name for context. */
  readonly filename?: string;
  /**
   * One-sentence description of the runtime the code executed in (from
   * `runtimeNoteFor`). Keeps the model from suggesting fixes the runtime
   * cannot execute (e.g. pip installs under Pyodide). Included in the user
   * content, so it is always visible in the consent preview.
   */
  readonly runtimeNote?: string;
  /** Redact obvious secrets before building the request. Defaults to true. */
  readonly redact?: boolean;
  /** Optional model id to request (provider-specific). */
  readonly model?: string;
}

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface ExplainErrorRequest {
  /** Optional model id, passed through to the provider. */
  readonly model?: string;
  /** OpenAI-compatible chat messages. */
  readonly messages: readonly ChatMessage[];
  /**
   * Human-readable rendering of EXACTLY what would leave the device. The
   * consent surface shows this before sending; if the user cancels, nothing
   * is transmitted.
   */
  readonly preview: string;
  /** True when redaction masked at least one secret in the excerpt. */
  readonly redacted: boolean;
  /**
   * How many secrets redaction masked. Drives the visible "N secrets
   * redacted" consent indicator the Local AI ADR requires (a bare boolean
   * can't render an accurate count). 0 when nothing was masked.
   */
  readonly redactedCount: number;
}

const SYSTEM_PROMPT =
  'You are a concise programming assistant embedded in a code editor. ' +
  'Explain the error the user hit and suggest a concrete fix. Base your answer ' +
  'only on the code and error provided — do not invent code the user did not ' +
  'share, and do not ask for their API keys or secrets. When a Runtime is ' +
  'described, keep the fix compatible with it and do not suggest tools or ' +
  'packages that runtime cannot run.';

/**
 * Build the provider-agnostic "explain this error" request plus the consent
 * preview. Pure — no network. The caller sends the request only after the
 * user approves the preview.
 */
export function buildExplainErrorRequest(
  input: ExplainErrorInput
): ExplainErrorRequest {
  const redact = input.redact !== false;
  const redaction = redact
    ? redactSecretsFromCode(input.code)
    : { code: input.code, redactedCount: 0 };

  const code = clip(redaction.code, MAX_EXPLAIN_CODE_CHARS);
  const errorMessage = clip(input.errorMessage, MAX_EXPLAIN_ERROR_CHARS);
  const fileLabel = input.filename ? ` (${input.filename})` : '';

  const runtimeLine = input.runtimeNote
    ? `Runtime: ${input.runtimeNote}\n`
    : '';
  const userContent =
    `Language: ${input.language}${fileLabel}\n` +
    runtimeLine +
    `\nError:\n${errorMessage}\n\n` +
    `Code:\n\`\`\`${input.language}\n${code}\n\`\`\``;

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  const preview =
    'The following will be sent to your configured AI endpoint:\n\n' +
    messages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n');

  const request: ExplainErrorRequest = {
    messages,
    preview,
    redacted: redaction.redactedCount > 0,
    redactedCount: redaction.redactedCount,
  };
  return input.model ? { ...request, model: input.model } : request;
}
