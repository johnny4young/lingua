import { useEffect, useState } from 'react';
import { asRelativePath } from '../../../shared/fs/brandedIds';
import { getActiveTab, useEditorStore } from '../../stores/editorStore';
import { useGitStore } from '../../stores/gitStore';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectTestStore, type ProjectTestDisplayCase } from '../../stores/projectTestStore';
import { joinAbsolute } from '../../utils/filePath';
import { findCodeUnderTestChange, type CodeChange } from './codeUnderTestChange';

export type CodeChangeLookup = { status: 'pending' } | { status: 'done'; change: CodeChange | null };

/**
 * Looks up the uncommitted change in the code a failed test exercises, once
 * per run and HEAD. Without a git repository there is nothing to look up.
 */
export function useCodeUnderTestChange(entry: ProjectTestDisplayCase | undefined): CodeChangeLookup {
  const result = useProjectTestStore(state => state.result);
  const rootId = useProjectTestStore(state => state.rootId);
  const project = useProjectStore(state => state.currentProject);
  const repoRoot = useGitStore(state => (state.posture?.available ? state.posture.repoRoot : undefined));
  const commit = useGitStore(state => state.posture?.commit);
  const [lookup, setLookup] = useState<{ key: string; change: CodeChange | null } | null>(null);
  const bridge = typeof window === 'undefined' ? undefined : window.lingua?.git;
  const ready = entry && entry.failureFile && repoRoot && bridge && project && project.rootId === rootId;
  const key = ready ? JSON.stringify([entry.failureFile, entry.path, entry.failureLine, repoRoot, commit ?? null, project.rootPath]) : null;

  useEffect(() => {
    if (!key || !ready) return;
    let active = true;
    const root = project.rootId;
    // The open failure file, read when the lookup starts; typing in it does not start another one.
    const testSource = getActiveTab(useEditorStore.getState())?.content ?? '';
    const failingLine = testSource.split('\n')[entry.failureLine! - 1] ?? '';
    void findCodeUnderTestChange(
      { testFile: entry.failureFile!, testSource, failingLine },
      {
        listDirectory: async directory =>
          (await window.lingua.fs.readdir(root, asRelativePath(directory))).map(found => ({ name: found.name, isDirectory: found.isDirectory })),
        diff: async file => {
          const diff = await bridge.diff(repoRoot, joinAbsolute(project.rootPath, file));
          return { original: diff.originalContent, modified: diff.modifiedContent };
        },
      }
    )
      .catch(() => null)
      .then(change => {
        if (active) setLookup({ key, change });
      });
    return () => {
      active = false;
    };
    // `key` covers the entry, project and repository; `result` restarts it after each run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, result]);

  if (!key) return { status: 'done', change: null };
  return lookup?.key === key ? { status: 'done', change: lookup.change } : { status: 'pending' };
}
