import { useEffect, useMemo } from 'react';
import { useProjectTestStore } from '../../stores/projectTestStore';
import { useUIStore } from '../../stores/uiStore';
import type { FileTab } from '../../types/editor';
import { isLikelyTestFile } from '../../../shared/projectTests';

import { useCommandBarSlotStore, type ProjectTestFileRun } from '../../stores/commandBarSlotStore';

/** Publishes Run tests in file while the active tab is a test file of the open project and a runner is selected. */
export function useRegisterProjectTestFileRun(tab: Pick<FileTab, 'rootId' | 'relativePath'> | null): void {
  const rootId = tab?.rootId;
  const file = tab?.relativePath;
  // The store is bound to the open project once the Tests tab has detected its runner.
  const projectName = useProjectTestStore((state) =>
    state.selectedFramework !== null && rootId !== undefined && state.rootId === rootId ? state.projectName : null
  );
  const running = useProjectTestStore((state) => state.status === 'running');
  const likely = file !== undefined && isLikelyTestFile(file);
  // Only files outside the naming conventions need the reported-cases scan.
  const reported = useProjectTestStore((state) =>
    file && !likely ? (state.cases?.some((entry) => entry.file === file) ?? false) : false
  );
  const eligible = Boolean(projectName !== null && file && (likely || reported));
  const testFileRun = useMemo<ProjectTestFileRun | null>(() => {
    if (!eligible || projectName === null || !file) return null;
    return {
      disabled: running,
      run: () => {
        useUIStore.getState().openBottomPanel('tests');
        const store = useProjectTestStore.getState();
        if (store.rootId) void store.run({ rootId: store.rootId, projectName }, { kind: 'file', file });
      },
    };
  }, [eligible, projectName, file, running]);
  useEffect(() => {
    const { setTestFileRun } = useCommandBarSlotStore.getState();
    setTestFileRun(testFileRun);
    return () => setTestFileRun(null);
  }, [testFileRun]);
}
