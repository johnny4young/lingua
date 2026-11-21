/**
 * Reads last answers for Start and the palette; persisted entries are checked again on read.
 * Import it from lazy surfaces only: it pulls the summary module in statically.
 */

import type { EditorState } from '../types/editor';
import type { Language } from '../types/language';
import { sanitizeLastAnswer, type LastAnswer } from '../utils/lastAnswer';
import { useEditorStore } from './editorStore';
import type { RecentProject } from './projectStore';
import { useSessionStore, getPendingSessionRestoreSnapshot } from './sessionStore';

export function selectTabLastAnswer(tabId: string): (state: Pick<EditorState, 'tabs'>) => LastAnswer | undefined {
  return state => state.tabs.find(tab => tab.id === tabId)?.lastAnswer;
}

export interface SessionTabAnswer {
  name: string;
  language: Language;
  kind?: 'notebook' | 'sql' | 'http' | 'utilities';
  filePath?: string;
  lastAnswer: LastAnswer;
}

/** Tabs of the session a restore would bring back that carry an answer, in tab order. */
export function getSessionTabAnswers(): SessionTabAnswer[] {
  const { savedTabs } = getPendingSessionRestoreSnapshot() ?? useSessionStore.getState();
  return savedTabs.flatMap(tab => {
    const lastAnswer = sanitizeLastAnswer(tab.lastAnswer);
    if (!lastAnswer) return [];
    return [
      {
        name: tab.name,
        language: tab.language,
        ...(tab.kind ? { kind: tab.kind } : {}),
        ...(tab.filePath ? { filePath: tab.filePath } : {}),
        lastAnswer,
      },
    ];
  });
}

/** The answer for a file on disk: its open tab first, then the saved session. */
export function lastAnswerForPath(filePath: string): LastAnswer | undefined {
  const open = useEditorStore.getState().tabs.find(tab => tab.filePath === filePath);
  if (open) return open.lastAnswer;
  return getSessionTabAnswers().find(tab => tab.filePath === filePath)?.lastAnswer;
}

/** A recent project's last whole-project test answer. */
export function projectLastAnswer(project: Pick<RecentProject, 'lastAnswer'>): LastAnswer | undefined {
  return sanitizeLastAnswer(project.lastAnswer);
}
