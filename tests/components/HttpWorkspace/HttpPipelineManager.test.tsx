import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpPipelineManager } from '../../../src/renderer/components/HttpWorkspace/HttpPipelineManager';
import {
  resetWorkspaceToolStoreForTests,
  useWorkspaceToolStore,
} from '../../../src/renderer/stores/workspaceToolStore';
import { createBlankHttpRequest } from '../../../src/shared/httpWorkspaceSchema';

describe('HttpPipelineManager', () => {
  beforeEach(() => {
    resetWorkspaceToolStoreForTests();
    useWorkspaceToolStore.getState().createRequest({
      ...createBlankHttpRequest({ id: 'request-1', name: 'Create session' }),
      url: 'https://api.example.com/session',
    });
  });

  it('creates a pipeline, adds an HTTP request, and exposes it to the runner', async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    render(
      <HttpPipelineManager
        onClose={vi.fn()}
        run={null}
        onRun={onRun}
        onStop={vi.fn()}
      />
    );

    await user.click(
      screen.getAllByRole('button', { name: 'New pipeline' })[0]!
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Add request' }),
      'request-1'
    );
    await user.click(screen.getByRole('button', { name: 'Run pipeline' }));

    expect(onRun).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Untitled pipeline',
        stopOnFailure: true,
        steps: [
          expect.objectContaining({ requestId: 'request-1', enabled: true }),
        ],
      })
    );
  });
});
