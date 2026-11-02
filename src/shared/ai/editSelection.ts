/**
 * "Edit selection with AI": the request that asks the configured provider to
 * rewrite one span of a file, and the reading of its answer. Pure, no network.
 */

import { answerLanguageLine, previewOf, redactSecretsFromCode, type ChatMessage, type RedactionResult } from './explainError';

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
  /** What was sent, and the span Accept replaces. */
  readonly span: RedactedSpan;
  readonly model?: string;
}

const SYSTEM_PROMPT =
  'You edit code inside a code editor. The user marks one span of their file between ' +
  `${START} and ${END} and says what to change. Reply with only the new code for that span, ` +
  'in one fenced code block, with no explanation. Keep everything outside the span as it is, ' +
  'match the surrounding indentation, and never invent secrets or ask for keys.';

/** The redacted file around the span to edit; `start`/`end` may be wider than asked (see `redactAround`). */
interface RedactedSpan {
  readonly before: string;
  readonly selected: string;
  readonly after: string;
  readonly start: number;
  readonly end: number;
  readonly redactedCount: number;
}

function lineStart(code: string, offset: number): number {
  return code.lastIndexOf('\n', offset - 1) + 1;
}

function lineEnd(code: string, offset: number): number {
  if (offset > 0 && code[offset - 1] === '\n') return offset;
  const next = code.indexOf('\n', offset);
  return next === -1 ? code.length : next;
}

/**
 * Redacts the text before, inside and after the span separately, so the markers
 * can go between them without hiding a secret from the line-anchored and token
 * patterns. When that differs from redacting the whole file (a boundary splits a
 * secret), the span widens to whole lines, then to the whole file.
 */
function redactAround(code: string, start: number, end: number): RedactedSpan {
  const whole = redactSecretsFromCode(code).code;
  const spans: Array<[number, number]> = [
    [start, end],
    [lineStart(code, start), lineEnd(code, end)],
    [0, code.length],
  ];
  for (const [from, to] of spans) {
    const parts = [code.slice(0, from), code.slice(from, to), code.slice(to)].map(redactSecretsFromCode);
    if (parts.map(part => part.code).join('') !== whole) continue;
    const [before, selected, after] = parts as [RedactionResult, RedactionResult, RedactionResult];
    const redactedCount = before.redactedCount + selected.redactedCount + after.redactedCount;
    return { before: before.code, selected: selected.code, after: after.code, start: from, end: to, redactedCount };
  }
  throw new Error('unreachable: the whole-file span always matches');
}

function window(span: RedactedSpan): string {
  const marked = `${span.before}${START}${span.selected}${END}${span.after}`;
  if (marked.length <= MAX_EDIT_FILE_CHARS) return marked;
  const lines = marked.split('\n');
  // From the parts, not a marker search: the file itself may contain the marker text.
  const first = span.before.split('\n').length - 1;
  const last = first + span.selected.split('\n').length - 1;
  const from = Math.max(0, first - CONTEXT_LINES);
  const to = Math.min(lines.length, last + CONTEXT_LINES + 1);
  return `${from > 0 ? '…\n' : ''}${lines.slice(from, to).join('\n')}${to < lines.length ? '\n…' : ''}`;
}

export function buildEditSelectionRequest(input: EditSelectionInput): EditSelectionRequest {
  const span = redactAround(input.code, input.start, input.end);
  const fileLabel = input.filename ? ` (${input.filename})` : '';
  const instruction = input.instruction.trim().slice(0, MAX_EDIT_INSTRUCTION_CHARS);
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        `Language: ${input.language}${fileLabel}\n` +
        answerLanguageLine(input.answerLanguage) +
        `Change: ${instruction}\n\nFile:\n\`\`\`${input.language}\n${window(span)}\n\`\`\``,
    },
  ];
  const request: EditSelectionRequest = { messages, preview: previewOf(messages), redactedCount: span.redactedCount, span };
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
