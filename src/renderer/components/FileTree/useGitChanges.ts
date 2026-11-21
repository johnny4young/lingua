import { useEffect, useState } from 'react';
import type { GitFolderChanges } from '../../../shared/gitTypes';
import { gitDetectKey, useGitStore } from '../../stores/gitStore';
import type { RootId } from '../../../shared/fs/brandedIds';

const REFRESH_DEBOUNCE_MS = 400;
const FOCUS_REFRESH_MIN_AGE_MS = 5_000;
// Object and log writes never change what status reports; the index and refs do.
const IGNORED_GIT_PATHS = /^\.git\/(objects|logs)\//u;

function sameChanges(a: GitFolderChanges | null, b: GitFolderChanges | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.truncated !== b.truncated || a.paths.length !== b.paths.length) return false;
  return a.paths.every((entry, index) => entry.path === b.paths[index]?.path && entry.status === b.paths[index]?.status);
}

interface ProjectRef {
  rootId: RootId;
  rootPath: string;
}

/**
 * Changed paths under the open project, refreshed after file changes, commits
 * and window focus. Null while Git is unavailable or has not answered.
 */
export function useGitChanges(project: ProjectRef | null): GitFolderChanges | null {
  // Until this project's detect lands, the posture may still be the previous project's.
  const repoRoot = useGitStore(state =>
    state.posture?.available && project && state.lastDetectKey === gitDetectKey(project.rootPath, project.rootId)
      ? state.posture.repoRoot ?? null
      : null
  );
  const commit = useGitStore(state => state.posture?.commit ?? null);
  const branch = useGitStore(state => state.posture?.branch ?? null);
  const rootId = project?.rootId ?? null;
  const rootPath = project?.rootPath ?? null;
  const key = repoRoot && rootId && rootPath ? `${repoRoot}\u0000${rootId}\u0000${rootPath}` : null;
  const [answer, setAnswer] = useState<{ key: string; changes: GitFolderChanges | null } | null>(null);

  useEffect(() => {
    const bridge = window.lingua?.git;
    const changes = bridge?.changes;
    if (!key || !repoRoot || !rootId || !rootPath || !changes) return;
    let active = true;
    let timer: number | null = null;
    let inFlight = false;
    let again = false;
    let answeredAt = 0;
    // After a failed query (a status slower than the timeout), only focus or a commit asks again.
    let failed = false;

    const query = async (): Promise<void> => {
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      try {
        const result = await changes(repoRoot, rootPath);
        if (active) keep(result);
      } catch {
        if (active) keep(null);
      } finally {
        inFlight = false;
        if (again && active) {
          again = false;
          schedule();
        }
      }
    };
    const keep = (next: GitFolderChanges | null): void => {
      answeredAt = Date.now();
      failed = next === null;
      setAnswer(previous =>
        previous?.key === key && sameChanges(previous.changes, next) ? previous : { key, changes: next }
      );
    };
    const schedule = (): void => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void query();
      }, REFRESH_DEBOUNCE_MS);
    };

    void query();
    const unsubscribe = window.lingua.fs?.onChanged?.(event => {
      if (!failed && event.rootId === rootId && !IGNORED_GIT_PATHS.test(event.relativePath)) schedule();
    });
    const onFocus = (): void => {
      if (Date.now() - answeredAt >= FOCUS_REFRESH_MIN_AGE_MS) schedule();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
      unsubscribe?.();
      window.removeEventListener('focus', onFocus);
    };
    // The key covers the folder; a commit or branch switch changes the answer without touching it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, commit, branch]);

  return answer && answer.key === key ? answer.changes : null;
}
