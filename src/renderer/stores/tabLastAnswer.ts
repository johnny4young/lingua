import type { ExecutionResult } from '../types/execution';
import type { LastAnswer } from '../utils/lastAnswer';
import { useEditorStore } from './editorStore';
import type { LineResult } from './resultStore';

type LastAnswerModule = typeof import('../utils/lastAnswer');

// Loaded on the first finished run so the summary code stays off the startup graph.
export const loadLastAnswer = (): Promise<LastAnswerModule> => import('../utils/lastAnswer');

// "Time ago" reads in minutes, so a repeat answer inside this window skips the tab write and session save.
const SAME_ANSWER_REFRESH_MS = 60_000;

/** The same answer apart from its timing, which jitters run to run. */
function sameAnswer(next: LastAnswer, previous: LastAnswer | undefined): boolean {
  if (!previous || next.ranAt - previous.ranAt >= SAME_ANSWER_REFRESH_MS) return false;
  const shape = ({ ranAt: _ranAt, durationMs: _durationMs, deltaMs: _deltaMs, ...rest }: LastAnswer) => JSON.stringify(rest);
  return shape(next) === shape(previous);
}

/** Stores a run's answer on its tab; a closed tab keeps nothing. */
export async function recordTabLastAnswer(
  tabId: string,
  build: (answers: LastAnswerModule, ranAt: number) => LastAnswer
): Promise<void> {
  const ranAt = Date.now();
  const answers = await loadLastAnswer().catch(() => null);
  if (!answers) return;
  const answer = build(answers, ranAt);
  useEditorStore.setState(state => {
    const tab = state.tabs.find(candidate => candidate.id === tabId);
    if (!tab || sameAnswer(answer, tab.lastAnswer)) return {};
    const lastAnswer = answers.withDelta(answer, tab.lastAnswer);
    return { tabs: state.tabs.map(candidate => (candidate === tab ? { ...candidate, lastAnswer } : candidate)) };
  });
}

/** A code run's answer from what the result panel shows. */
export function recordCodeLastAnswer(
  tabId: string,
  result: ExecutionResult,
  presentation: { lineResults: readonly LineResult[]; fullOutput: string }
): void {
  const { lineResults, fullOutput } = presentation;
  void recordTabLastAnswer(tabId, ({ codeLastAnswer }, ranAt) => codeLastAnswer({ result, lineResults, fullOutput, ranAt }));
}
