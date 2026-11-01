/**
 * "Edit selection with AI": the request that asks the configured provider to
 * rewrite one span of a file, and the reading of its answer. Pure, no network.
 */

import { answerLanguageLine, previewOf, redactSecretsFromCode, type ChatMessage } from './explainError';

export const MAX_EDIT_INSTRUCTION_CHARS = 500;
/** Past this the file is sent as the selection with this many lines around it. */
const MAX_EDIT_FILE_CHARS = 12_000;
const CONTEXT_LINES = 60;
const START = '<<<SELECTION>>>';
const END = '<<<END SELECTION>>>';
/** What redaction leaves in place of a secret; an answer that still holds it would overwrite the real value. */
export const REDACTED_MARK = '<redacted>';

export interface EditSelectionInput {
  readonly code: string;
  /** Character offsets of the selection in `code`. */
  readonly start: number;
  readonly end: number;
  readonly instruction: string;
  readonly language: string;
  readonly filename?: string;
  readonly answerLanguage?: string;
  readonly model?: string;
}

export interface EditSelectionRequest {
  readonly messages: ChatMessage[];
  readonly preview: string;
  readonly redactedCount: number;
  readonly model?: string;
}

const SYSTEM_PROMPT =
  'You edit code inside a code editor. The user marks one span of their file between ' +
  `${START} and ${END} and says what to change. Reply with only the new code for that span, ` +
  'in one fenced code block, with no explanation. Keep everything outside the span as it is, ' +
  'match the surrounding indentation, and never invent secrets or ask for keys.';

function window(code: string, start: number, end: number): string {
  const marked = `${code.slice(0, start)}${START}${code.slice(start, end)}${END}${code.slice(end)}`;
  if (marked.length <= MAX_EDIT_FILE_CHARS) return marked;
  const lines = marked.split('\n');
  // From offsets, not a marker search: the file itself may contain the marker text.
  const first = code.slice(0, start).split('\n').length - 1;
  const last = first + code.slice(start, end).split('\n').length - 1;
  const from = Math.max(0, first - CONTEXT_LINES);
  const to = Math.min(lines.length, last + CONTEXT_LINES + 1);
  return `${from > 0 ? '…\n' : ''}${lines.slice(from, to).join('\n')}${to < lines.length ? '\n…' : ''}`;
}

export function buildEditSelectionRequest(input: EditSelectionInput): EditSelectionRequest {
  const marked = window(input.code, input.start, input.end);
  const redaction = redactSecretsFromCode(marked);
  const fileLabel = input.filename ? ` (${input.filename})` : '';
  const instruction = input.instruction.trim().slice(0, MAX_EDIT_INSTRUCTION_CHARS);
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        `Language: ${input.language}${fileLabel}\n` +
        answerLanguageLine(input.answerLanguage) +
        `Change: ${instruction}\n\nFile:\n\`\`\`${input.language}\n${redaction.code}\n\`\`\``,
    },
  ];
  const request: EditSelectionRequest = { messages, preview: previewOf(messages), redactedCount: redaction.redactedCount };
  return input.model ? { ...request, model: input.model } : request;
}

/**
 * The replacement in an answer: its first fenced block, or the whole answer, without stray markers.
 * A selection that ended with a line break keeps it, so Accept does not join the next line.
 */
export function readEditAnswer(answer: string, selected = ''): string {
  const fenced = /```[\w+-]*\n([\s\S]*?)```/.exec(answer);
  const body = (fenced ? fenced[1]! : answer).replace(/\n$/, '');
  const replacement = body.split(START).join('').split(END).join('');
  return selected.endsWith('\n') && !replacement.endsWith('\n') ? `${replacement}\n` : replacement;
}

/** The file with `replacement` in place of the selection. */
export function applyEdit(code: string, start: number, end: number, replacement: string): string {
  return `${code.slice(0, start)}${replacement}${code.slice(end)}`;
}
