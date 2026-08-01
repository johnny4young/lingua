/** Deterministic browser fixture for bilingual local MCP Settings evidence. */

import { asRootId } from '../../shared/fs/brandedIds';
import type { LocalMcpState } from '../../shared/localMcp';
import { setPendingSettingsTab } from '../components/Settings/pendingSettingsTab';
import { useProjectStore } from '../stores/projectStore';

const rootId = asRootId('e2e-local-mcp-root');

export function prepareLocalMcpE2eFixture(): void {
  let state: LocalMcpState = { status: 'stopped' };
  const listeners = new Set<(state: LocalMcpState) => void>();
  const emit = () => listeners.forEach(listener => listener(state));

  window.lingua = {
    ...window.lingua,
    localMcp: {
      getState: async () => state,
      start: async () => {
        state = {
          status: 'running',
          endpoint: 'http://127.0.0.1:43127/mcp',
          accessToken: 'lingua-demo-session-token-not-a-real-secret',
          projectName: 'polyglot-checkout',
          startedAt: '2026-08-01T12:00:00.000Z',
          requestCount: 3,
          toolCallCount: 2,
          tools: [
            'lingua_project_info',
            'lingua_list_files',
            'lingua_read_file',
            'lingua_search_project',
          ],
        };
        emit();
        return { ok: true, state } as const;
      },
      stop: async () => {
        state = { status: 'stopped', reason: 'user' };
        emit();
        return state;
      },
      onStateChanged: handler => {
        listeners.add(handler);
        return () => listeners.delete(handler);
      },
    },
  };

  useProjectStore.setState({
    currentProject: {
      id: 'e2e-local-mcp',
      name: 'polyglot-checkout',
      rootPath: '/Users/demo/polyglot-checkout',
      openedAt: 1,
      rootId,
    },
    nodes: [],
  });
  setPendingSettingsTab('integrations');
}
