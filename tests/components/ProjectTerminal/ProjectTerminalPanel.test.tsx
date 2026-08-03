import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asRootId } from '../../../src/shared/fs/brandedIds';
import { ProjectTerminalPanel } from '../../../src/renderer/components/ProjectTerminal/ProjectTerminalPanel';
import {
  _resetProjectTerminalListenersForTests,
  useProjectTerminalStore,
} from '../../../src/renderer/stores/projectTerminalStore';
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore';

const xterm = vi.hoisted(() => ({
  instances: [] as Array<{
    write: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 100;
    rows = 30;
    write = vi.fn();
    clear = vi.fn();
    focus = vi.fn();
    open = vi.fn();
    loadAddon = vi.fn();
    dispose = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));

    constructor() {
      xterm.instances.push(this);
    }
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn();
    dispose = vi.fn();
  },
}));

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

const binding = { rootId: asRootId('root-a'), projectName: 'Alpha' };
let dataListener: ((event: { sessionId: string; data: string }) => void) | undefined;
let exitListener: ((event: ProjectTerminalExitEvent) => void) | undefined;
let start: ReturnType<typeof vi.fn>;

function resetStore() {
  useProjectTerminalStore.setState({
    rootId: binding.rootId,
    projectName: binding.projectName,
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

beforeEach(async () => {
  xterm.instances.length = 0;
  _resetProjectTerminalListenersForTests();
  start = vi.fn().mockResolvedValue({ ok: true, sessionId: 'session-a', shellName: 'zsh' });
  window.lingua = {
    ...(window.lingua ?? ({ platform: 'darwin' } as LinguaAPI)),
    projectTerminal: {
      start,
      write: vi.fn().mockResolvedValue({ written: true }),
      resize: vi.fn().mockResolvedValue({ resized: true }),
      stop: vi.fn().mockResolvedValue({ stopped: true }),
      onData: vi.fn(listener => {
        dataListener = listener;
        return () => undefined;
      }),
      onExit: vi.fn(listener => {
        exitListener = listener;
        return () => undefined;
      }),
    },
  } as LinguaAPI;
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  useSettingsStore.setState({ nativeExecutionAcknowledged: true });
  resetStore();
  await i18next.changeLanguage('en');
});

afterEach(() => {
  cleanup();
});

describe('ProjectTerminalPanel', () => {
  it('explains the real-shell boundary before starting the terminal', () => {
    render(<ProjectTerminalPanel binding={binding} />);
    expect(screen.getByText('Terminal for Alpha')).toBeTruthy();
    expect(screen.getByText(/it is not a sandbox/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start terminal' })).toBeTruthy();
  });

  it('starts the native terminal and renders buffered PTY output', async () => {
    const user = userEvent.setup();
    render(<ProjectTerminalPanel binding={binding} />);
    await user.click(screen.getByTestId('project-terminal-start'));
    expect(start).toHaveBeenCalledWith(binding.rootId, 100, 30);
    await screen.findByTestId('project-terminal-xterm');

    act(() => dataListener?.({ sessionId: 'session-a', data: 'alpha-ready\r\n' }));
    expect(xterm.instances.at(-1)?.write).toHaveBeenCalledWith('alpha-ready\r\n');
    expect(screen.getByText('zsh · active')).toBeTruthy();
  });

  it('keeps completed output visible and offers a fresh session after exit', async () => {
    const user = userEvent.setup();
    render(<ProjectTerminalPanel binding={binding} />);
    await user.click(screen.getByTestId('project-terminal-start'));
    await screen.findByTestId('project-terminal-xterm');
    act(() => dataListener?.({ sessionId: 'session-a', data: 'done\r\n' }));
    act(() =>
      exitListener?.({ sessionId: 'session-a', exitCode: 0, signal: 0, reason: 'exited' })
    );

    expect(screen.getByText('Exited · code 0')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New session' })).toBeTruthy();
    expect(xterm.instances.at(-1)?.write).toHaveBeenCalledWith('done\r\n');
  });

  it('localizes the start surface in neutral Latin American Spanish', async () => {
    await i18next.changeLanguage('es');
    render(<ProjectTerminalPanel binding={binding} />);
    expect(screen.getByText('Terminal para Alpha')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Inicia la terminal' })).toBeTruthy();
    expect(screen.getByText(/no es una caja de arena/i)).toBeTruthy();
  });
});
