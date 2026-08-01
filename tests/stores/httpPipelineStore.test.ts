import { beforeEach, describe, expect, it } from 'vitest';
import { createBlankHttpPipeline } from '../../src/shared/httpPipeline';
import { createBlankHttpRequest } from '../../src/shared/httpWorkspaceSchema';
import {
  resetWorkspaceToolStoreForTests,
  useWorkspaceToolStore,
} from '../../src/renderer/stores/workspaceToolStore';

describe('HTTP pipeline store', () => {
  beforeEach(() => resetWorkspaceToolStoreForTests());

  it('persists ordered steps and prunes references when a request is deleted', () => {
    const store = useWorkspaceToolStore.getState();
    const request = createBlankHttpRequest({ id: 'request-1' });
    store.createRequest(request);
    expect(
      store.createHttpPipeline({
        ...createBlankHttpPipeline({ id: 'pipeline-1' }),
        steps: [{ id: 'step-1', requestId: request.id, enabled: true }],
      })
    ).toBe(true);

    useWorkspaceToolStore.getState().deleteRequest(request.id);
    expect(useWorkspaceToolStore.getState().httpPipelines[0]?.steps).toEqual([]);
  });

  it('duplicates steps with fresh ids and preserves the source pipeline', () => {
    const store = useWorkspaceToolStore.getState();
    store.createHttpPipeline({
      ...createBlankHttpPipeline({ id: 'pipeline-1', name: 'Login' }),
      steps: [{ id: 'step-1', requestId: 'request-1', enabled: true }],
    });
    useWorkspaceToolStore
      .getState()
      .duplicateHttpPipeline('pipeline-1', 'pipeline-2', 'copy');

    const [source, clone] = useWorkspaceToolStore.getState().httpPipelines;
    expect(source?.steps[0]?.id).toBe('step-1');
    expect(clone).toMatchObject({ id: 'pipeline-2', name: 'Login copy' });
    expect(clone?.steps[0]?.id).not.toBe('step-1');
  });
});
