import type { FileTab } from '../../types/editor';
import type { Language } from '../../types/language';
import type { LastAnswer } from '../../utils/lastAnswer';
import type { RecentFile } from '../../stores/recentFilesStore';
import { answerIdentity } from '../Start/answerLabels';
import type { CommandEntry } from './commandPaletteModel';

/** The palette leads with this many recent files. */
export const RECENT_FILE_ROWS = 3;

type RecentTab = Pick<FileTab, 'id' | 'name' | 'language' | 'kind' | 'filePath' | 'lastEditedAt' | 'lastAnswer'>;

export interface RecentFileSources {
  tabs: readonly RecentTab[];
  recentFiles: readonly RecentFile[];
  /** Answer a closed file left in the saved session. */
  answerForPath: (filePath: string) => LastAnswer | undefined;
  /** Both close the palette first. */
  openTab: (tabId: string) => void;
  reopenFile: (file: { path: string; name: string; language: Language }) => void;
}

interface Candidate {
  entry: CommandEntry;
  recency: number;
}

function latest(...times: Array<number | undefined>): number {
  return Math.max(0, ...times.map(time => time ?? 0));
}

/**
 * Open tabs and recently opened files, newest activity first, each with the
 * answer its last run left. Utility tabs are not files and stay out.
 */
export function buildRecentFileEntries(sources: RecentFileSources): CommandEntry[] {
  const { tabs, recentFiles, answerForPath, openTab, reopenFile } = sources;
  const candidates: Candidate[] = [];
  const openedAt = new Map(recentFiles.map(file => [file.filePath, file.openedAt]));
  const openPaths = new Set<string>();

  for (const tab of tabs) {
    if (tab.kind === 'utilities') continue;
    if (tab.filePath) openPaths.add(tab.filePath);
    const { badge, name } = answerIdentity(tab, tab.lastAnswer);
    candidates.push({
      recency: latest(tab.lastEditedAt, tab.lastAnswer?.ranAt, tab.filePath ? openedAt.get(tab.filePath) : undefined),
      entry: recentFileEntry(`recent-file-tab-${tab.id}`, name, badge, tab.lastAnswer, () => openTab(tab.id)),
    });
  }

  for (const file of recentFiles) {
    if (openPaths.has(file.filePath)) continue;
    const answer = answerForPath(file.filePath);
    candidates.push({
      recency: latest(file.openedAt, answer?.ranAt),
      entry: recentFileEntry(`recent-file-path-${file.filePath}`, file.name, file.language, answer, () =>
        reopenFile({ path: file.filePath, name: file.name, language: file.language })
      ),
    });
  }

  // `sort` is stable, so equal recency keeps tab order and then file history order.
  return candidates
    .sort((a, b) => b.recency - a.recency)
    .slice(0, RECENT_FILE_ROWS)
    .map(candidate => candidate.entry);
}

function recentFileEntry(
  id: string,
  label: string,
  language: Language,
  answer: LastAnswer | undefined,
  action: () => void
): CommandEntry {
  return {
    id,
    category: 'file',
    label,
    description: '',
    language,
    keywords: [],
    ...(answer ? { answer } : {}),
    action,
  };
}
