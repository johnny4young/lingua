import type { GitChangedStatus, GitFolderChanges } from '../../../shared/gitTypes';
import { isProjectTestRunFailure, type ProjectTestDisplayCase } from '../../stores/projectTestStore';

export type GitMark = GitChangedStatus;

export interface TestTally {
  passed: number;
  /** Tests that ran or are waiting on a rerun; skipped tests are left out. */
  total: number;
  tone: 'failed' | 'passed' | 'pending';
}

function finishTally(passed: number, total: number, failed: boolean): TestTally {
  return { passed, total, tone: failed ? 'failed' : total > 0 && passed === total ? 'passed' : 'pending' };
}

/** One tally for the whole run, and one per reported file (Go reports package folders). */
export function tallyTests(cases: readonly ProjectTestDisplayCase[]): { all: TestTally; byFile: Map<string, TestTally> } {
  const files = new Map<string, { passed: number; total: number; failed: boolean }>();
  let passed = 0;
  let total = 0;
  let failed = false;
  for (const entry of cases) {
    const current = entry.status === 'failed' && !entry.stale;
    let file = files.get(entry.file);
    if (!file) {
      file = { passed: 0, total: 0, failed: false };
      files.set(entry.file, file);
    }
    file.failed ||= current;
    failed ||= current;
    // Build and load diagnostics fail a file without being a test of it.
    if (entry.status === 'skipped' || isProjectTestRunFailure(entry)) continue;
    const ok = entry.status === 'passed' && !entry.stale;
    file.total += 1;
    total += 1;
    if (ok) {
      file.passed += 1;
      passed += 1;
    }
  }
  const byFile = new Map<string, TestTally>();
  for (const [file, tally] of files) byFile.set(file, finishTally(tally.passed, tally.total, tally.failed));
  return { all: finishTally(passed, total, failed), byFile };
}

export interface GitMarks {
  count: number;
  /** The count as shown, with a plus when Git listed more than the cap. */
  shown: string;
  markFor: (path: string) => GitMark | undefined;
}

export function gitMarksFrom(changes: GitFolderChanges): GitMarks {
  const files = new Map<string, GitMark>();
  const untrackedFolders: string[] = [];
  for (const entry of changes.paths) {
    if (entry.path === '' || entry.path.endsWith('/')) untrackedFolders.push(entry.path);
    else files.set(entry.path, entry.status);
  }
  return {
    count: changes.paths.length,
    shown: changes.truncated ? `${changes.paths.length}+` : String(changes.paths.length),
    markFor: path =>
      files.get(path) ??
      (untrackedFolders.some(folder => path.startsWith(folder) || `${path}/` === folder) ? 'untracked' : undefined),
  };
}
