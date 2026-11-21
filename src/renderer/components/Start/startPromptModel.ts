import { isJavaScriptFamily } from '../../../shared/languageFamilies';
import { runPolicyDelayMs, type RunPolicyByGroup } from '../../../shared/runPolicy';
import { inferKind } from '../Editor/inlineResultWidgetDom';
import type { ExecutionResult } from '../../types/execution';
import { toFullOutput, toLineResults } from '../../utils/executionPresentation';
import type { LastAnswer } from '../../utils/lastAnswer';

type LastAnswerModule = typeof import('../../utils/lastAnswer');

/** JS and TS run in the worker once the line pauses, unless their run policy is Manual; the rest wait for Enter. */
export function runsOnPause(language: string, policies?: RunPolicyByGroup): boolean {
  if (!isJavaScriptFamily(language)) return false;
  return !policies || runPolicyDelayMs(language, policies) !== null;
}

/** Paste and drop can carry line breaks; the prompt keeps a single line. */
export function toOneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*$/, '').replace(/\s*[\r\n]+\s*/g, ' ');
}

const PROMPT_VALUE_KINDS = ['array', 'object', 'string', 'number', 'boolean'] as const;

export type PromptValueKind = (typeof PROMPT_VALUE_KINDS)[number];

export interface PromptAnswer {
  answer: LastAnswer;
  /** Type of the value the line evaluated to; absent for printed output and failed runs. */
  valueKind?: PromptValueKind;
}

/** The editor's inline type pill heuristic; null and undefined get no tag. */
export function valueKind(value: string): PromptValueKind | undefined {
  const kind = inferKind(value);
  return (PROMPT_VALUE_KINDS as readonly string[]).includes(kind) ? (kind as PromptValueKind) : undefined;
}

/** The line's answer, read the way an editor tab's run is read. */
export function promptAnswer(answers: LastAnswerModule, code: string, result: ExecutionResult, ranAt: number): PromptAnswer {
  const lineResults = toLineResults(result, code);
  const answer = answers.codeLastAnswer({ result, lineResults, fullOutput: toFullOutput(result), ranAt });
  const shown = answer.status === 'ok' ? answers.lastValueOnPage(lineResults) : undefined;
  const kind = shown ? valueKind(shown.value) : undefined;
  return kind ? { answer, valueKind: kind } : { answer };
}
