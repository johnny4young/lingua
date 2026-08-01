/** Deterministic browser fixture for bilingual integrated-terminal UI evidence. */

import { asRootId } from '../../shared/fs/brandedIds';
import type { ProjectTerminalExitEvent } from '../../shared/projectTerminal';
import { useProjectStore } from '../stores/projectStore';
import { useProjectTerminalStore } from '../stores/projectTerminalStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';

const rootId = asRootId('e2e-project-terminal-root');

export function prepareProjectTerminalE2eFixture(): void {
  let dataListener: ((event: { sessionId: string; data: string }) => void) | null = null;
  let exitListener: ((event: ProjectTerminalExitEvent) => void) | null = null;
  const sessionId = 'e2e-project-terminal-session';

  window.lingua = {
    ...window.lingua,
    projectTerminal: {
      start: async () => {
        setTimeout(() => {
          dataListener?.({
            sessionId,
            data:
              '\u001b[36m$\u001b[0m pwd\r\n/Users/demo/polyglot-checkout\r\n' +
              '\u001b[36m$\u001b[0m node --version\r\nv24.16.0\r\n' +
              '\u001b[32mProject terminal ready\u001b[0m\r\n',
          });
        }, 20);
        return { ok: true, sessionId, shellName: 'zsh' } as const;
      },
      write: async () => ({ written: true }),
      resize: async () => ({ resized: true }),
      stop: async () => {
        exitListener?.({
          sessionId,
          exitCode: null,
          signal: null,
          reason: 'stopped',
        });
        return { stopped: true };
      },
      onData: handler => {
        dataListener = handler;
        return () => {
          if (dataListener === handler) dataListener = null;
        };
      },
      onExit: handler => {
        exitListener = handler;
        return () => {
          if (exitListener === handler) exitListener = null;
        };
      },
    },
  };

  useProjectStore.setState({
    currentProject: {
      id: 'e2e-project-terminal',
      name: 'polyglot-checkout',
      rootPath: '/Users/demo/polyglot-checkout',
      openedAt: 1,
      rootId,
    },
    nodes: [],
  });
  useSettingsStore.setState({ nativeExecutionAcknowledged: true });
  useUIStore.setState({
    activeBottomPanel: 'project-terminal',
    consoleVisible: true,
  });
  useProjectTerminalStore.setState({
    rootId,
    projectName: 'polyglot-checkout',
    status: 'idle',
    sessionId: null,
    shellName: null,
    chunks: [],
    bufferChars: 0,
    nextSequence: 1,
    exit: null,
    error: null,
  });
}
