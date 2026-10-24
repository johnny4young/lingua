import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWorkspaceRunTarget } from '../../src/renderer/hooks/useWorkspaceRunTarget';
import { emitCommand } from '../../src/renderer/stores/commandBus';
import { useWorkspaceRunReadyStore } from '../../src/renderer/stores/workspaceRunReadyStore';

describe('useWorkspaceRunTarget', () => {
  it('marks the workspace runnable while mounted and runs only its own kind', () => {
    const run = vi.fn();
    const { unmount } = renderHook(() => useWorkspaceRunTarget('sql', run));
    expect(useWorkspaceRunReadyStore.getState().ready).toEqual({ sql: true, http: false });

    emitCommand('workspace.run', { kind: 'http' });
    expect(run).not.toHaveBeenCalled();
    emitCommand('workspace.run', { kind: 'sql' });
    expect(run).toHaveBeenCalledTimes(1);

    unmount();
    expect(useWorkspaceRunReadyStore.getState().ready.sql).toBe(false);
  });

  it('reports a blocked workspace while its target says so, and clears it on unmount', () => {
    const { rerender, unmount } = renderHook(({ blocked }) => useWorkspaceRunTarget('http', vi.fn(), blocked), {
      initialProps: { blocked: true },
    });
    expect(useWorkspaceRunReadyStore.getState().blocked.http).toBe(true);
    rerender({ blocked: false });
    expect(useWorkspaceRunReadyStore.getState().blocked.http).toBe(false);
    rerender({ blocked: true });
    unmount();
    expect(useWorkspaceRunReadyStore.getState().blocked.http).toBe(false);
  });
});
