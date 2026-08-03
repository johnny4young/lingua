import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalMcpSection } from '../../../src/renderer/components/Settings/LocalMcpSection';
import { initI18n } from '../../../src/renderer/i18n';
import { useProjectStore } from '../../../src/renderer/stores/projectStore';
import { asRootId } from '../../../src/shared/fs/brandedIds';
import type { LocalMcpState } from '../../../src/shared/localMcp';

describe('LocalMcpSection', () => {
  beforeEach(async () => {
    await initI18n('en');
    await i18next.changeLanguage('en');
    useProjectStore.setState({
      currentProject: {
        id: 'project',
        name: 'demo-project',
        rootPath: '/tmp/demo-project',
        openedAt: 1,
        rootId: asRootId('root'),
      },
      nodes: [],
    });
  });

  it('requires consent, starts the scoped server, and stops it', async () => {
    const user = userEvent.setup();
    let state: LocalMcpState = { status: 'stopped' };
    const listeners = new Set<(next: LocalMcpState) => void>();
    const start = vi.fn(async () => {
      state = {
        status: 'running',
        endpoint: 'http://127.0.0.1:41234/mcp',
        accessToken: 'session-token',
        projectName: 'demo-project',
        startedAt: '2026-08-01T12:00:00.000Z',
        requestCount: 0,
        toolCallCount: 0,
        tools: ['lingua_project_info'],
      };
      return { ok: true, state } as const;
    });
    const stop = vi.fn(async () => ({ status: 'stopped', reason: 'user' }) as const);
    window.lingua = {
      ...(window.lingua ?? {}),
      localMcp: {
        getState: () => new Promise<LocalMcpState>(() => undefined),
        start,
        stop,
        onStateChanged: handler => {
          listeners.add(handler);
          return () => listeners.delete(handler);
        },
      },
    } as LinguaAPI;

    render(<LocalMcpSection />);
    const startButton = screen.getByRole('button', { name: 'Start server' });
    expect(startButton.hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('checkbox'));
    expect(startButton.hasAttribute('disabled')).toBe(false);
    await user.click(startButton);

    await screen.findByText('Connection ready');
    expect(screen.getByText('http://127.0.0.1:41234/mcp')).toBeTruthy();
    expect(start).toHaveBeenCalledWith(asRootId('root'), { readOnlySourceAccess: true });

    await user.click(screen.getByRole('button', { name: 'Stop server' }));
    await waitFor(() => expect(stop).toHaveBeenCalledOnce());
  });
});
