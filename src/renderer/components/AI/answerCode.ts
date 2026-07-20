/**
 * implementation — extract code from an AI answer. Own module (not in
 * ExplainErrorAnswer.tsx) so component files keep exporting only
 * components (react-refresh constraint).
 */

/**
 * First fenced code block of an answer, or `null`. The Apply-&-re-run and
 * NL→SQL Insert flows treat it as the model's proposed code.
 */
export function firstCodeBlock(markdown: string): string | null {
  const match = /```\w*\n?([\s\S]*?)```/.exec(markdown);
  const code = match?.[1]?.replace(/\n$/, '') ?? null;
  return code && code.trim().length > 0 ? code : null;
}
