import type { PropsWithChildren } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpWorkspacePanel } from '../../../src/renderer/components/HttpWorkspace';
import { useExecutionHistoryStore } from '../../../src/renderer/stores/executionHistoryStore';
import {
  resetWorkspaceToolStoreForTests,
  useWorkspaceToolStore,
} from '../../../src/renderer/stores/workspaceToolStore';
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore';
import type { HttpResponseV1 } from '../../../src/shared/httpWorkspace';

const { executeHttpRequestMock } =
  vi.hoisted(() => ({
    executeHttpRequestMock: vi.fn(),
  }));

vi.mock('react-resizable-panels', () => ({
  Group: ({ children, className }: PropsWithChildren<{ className?: string }>) => (
    <div className={className}>{children}</div>
  ),
  Panel: ({ children }: PropsWithChildren<{ id?: string }>) => <div>{children}</div>,
  useDefaultLayout: () => ({
    defaultLayout: undefined,
    onLayoutChanged: vi.fn(),
  }),
}));

vi.mock('../../../src/renderer/runtime/httpClient', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/renderer/runtime/httpClient')>();
  return {
    ...actual,
    executeHttpRequest: executeHttpRequestMock,
  };
});

function makeResponse(): HttpResponseV1 {
  return {
    version: 1,
    kind: 'success',
    status: 200,
    statusText: 'OK',
    url: 'https://api.example.com/users',
    finalUrl: 'https://api.example.com/users',
    headers: [],
    body: '{"ok":true}',
    contentType: 'application/json',
    sizeBytes: 11,
    durationMs: 10,
    tooLarge: false,
    redactedHeaders: [],
    recordedAt: '2026-05-26T00:00:00.000Z',
  };
}

describe('HttpWorkspacePanel', () => {
  beforeEach(() => {
    localStorage.clear();
    resetWorkspaceToolStoreForTests();
    useExecutionHistoryStore.getState().clear();
    useSettingsStore.setState({ sensitiveHttpHeaders: [] });
    executeHttpRequestMock.mockReset();
    executeHttpRequestMock.mockResolvedValue(makeResponse());
  });

  it('sends the current editor draft even before the debounce settles', async () => {
    const user = userEvent.setup();
    render(<HttpWorkspacePanel />);

    await user.click(screen.getByTestId('http-request-list-create'));
    await user.type(
      screen.getByTestId('http-request-editor-url'),
      'https://api.example.com/users'
    );
    await user.click(screen.getByTestId('http-request-editor-send'));

    await waitFor(() => expect(executeHttpRequestMock).toHaveBeenCalledTimes(1));
    const sentRequest = executeHttpRequestMock.mock.calls[0]?.[0];
    expect(sentRequest.url).toBe('https://api.example.com/users');
    expect(
      useWorkspaceToolStore.getState().requests[0]?.url
    ).toBe('https://api.example.com/users');
  });

  it('records an HTTP response capsule as the latest exportable capsule', async () => {
    const user = userEvent.setup();
    render(<HttpWorkspacePanel />);

    await user.click(screen.getByTestId('http-request-list-create'));
    await user.type(
      screen.getByTestId('http-request-editor-url'),
      'https://api.example.com/users'
    );
    await user.click(screen.getByTestId('http-request-editor-send'));

    await waitFor(() => {
      const latestCapsule = useExecutionHistoryStore.getState().latestCapsule();
      expect(latestCapsule?.tab.language).toBe('http');
      expect(latestCapsule?.environment.runner).toBe('http-client');
    });
  });
});
