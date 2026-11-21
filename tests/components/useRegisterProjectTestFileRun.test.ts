import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRegisterProjectTestFileRun } from '../../src/renderer/components/Editor/useRegisterProjectTestFileRun';
import { useCommandBarSlotStore } from '../../src/renderer/stores/commandBarSlotStore';
import { useProjectTestStore } from '../../src/renderer/stores/projectTestStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';

const tab = (relativePath: string) => ({ rootId: 'root-1', relativePath });

afterEach(() => {
  act(() => useProjectTestStore.setState({ rootId: null, projectName: null, selectedFramework: null, cases: null, status: 'idle' }));
});

describe('useRegisterProjectTestFileRun', () => {
  it('publishes Run tests in file for a test file once a runner is selected, and withdraws it on unmount', () => {
    const run = vi.fn(async () => undefined);
    act(() => useProjectTestStore.setState({ rootId: 'root-1' as never, projectName: 'demo', selectedFramework: 'vitest' as never, status: 'idle', cases: null, run }));
    const { unmount } = renderHook(() => useRegisterProjectTestFileRun(tab('src/sum.test.ts')));
    const published = useCommandBarSlotStore.getState().testFileRun;
    expect(published?.disabled).toBe(false);
    act(() => published?.run());
    expect(run).toHaveBeenCalledWith({ rootId: 'root-1', projectName: 'demo' }, { kind: 'file', file: 'src/sum.test.ts' });
    expect(useUIStore.getState().activeBottomPanel).toBe('tests');
    unmount();
    expect(useCommandBarSlotStore.getState().testFileRun).toBeNull();
  });

  it('skips non-test files, other roots, and projects without a runner, but accepts a file the runner reported', () => {
    act(() => useProjectTestStore.setState({ rootId: 'root-1' as never, projectName: 'demo', selectedFramework: null }));
    const { rerender } = renderHook(({ path }) => useRegisterProjectTestFileRun(tab(path)), { initialProps: { path: 'src/sum.test.ts' } });
    expect(useCommandBarSlotStore.getState().testFileRun).toBeNull();
    act(() => useProjectTestStore.setState({ selectedFramework: 'vitest' as never }));
    rerender({ path: 'src/sum.ts' });
    expect(useCommandBarSlotStore.getState().testFileRun).toBeNull();
    act(() => useProjectTestStore.setState({ cases: [{ file: 'src/sum.ts', path: ['adds'] }] as never }));
    expect(useCommandBarSlotStore.getState().testFileRun).not.toBeNull();
    act(() => useProjectTestStore.setState({ rootId: 'root-2' as never }));
    expect(useCommandBarSlotStore.getState().testFileRun).toBeNull();
  });
});
