import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asRootId } from '../../src/shared/fs/brandedIds';
import type {
  ProjectTerminalDataEvent,
  ProjectTerminalExitEvent,
  ProjectTerminalStartResult,
} from '../../src/shared/projectTerminal';
import {
  _resetProjectTerminalListenersForTests,
  useProjectTerminalStore,
} from '../../src/renderer/stores/projectTerminalStore';
import { useNativeExecutionGateStore } from '../../src/renderer/stores/nativeExecutionGateStore';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';

const bindingA = { rootId: asRootId('root-a'), projectName: 'Alpha' };
const bindingB = { rootId: asRootId('root-b'), projectName: 'Beta' };
let dataListener: ((event: ProjectTerminalDataEvent) => void) | undefined;
let exitListener: ((event: ProjectTerminalExitEvent) => void) | undefined;
let bridge: NonNullable<LinguaAPI['projectTerminal']>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function installBridge(
  overrides: Partial<NonNullable<LinguaAPI['projectTerminal']>> = {}
): void {
  bridge = {
    start: vi.fn().mockResolvedValue({
      ok: true,
      sessionId: 'session-a',
      shellName: 'zsh',
    }),
    write: vi.fn().mockResolvedValue({ written: true }),
    resize: vi.fn().mockResolvedValue({ resized: true }),
    stop: vi.fn().mockResolvedValue({ stopped: true }),
    onData: vi.fn(listener => {
      dataListener = listener;
      return () => {
        if (dataListener === listener) dataListener = undefined;
      };
    }),
    onExit: vi.fn(listener => {
      exitListener = listener;
      return () => {
        if (exitListener === listener) exitListener = undefined;
      };
    }),
    ...overrides,
  };
  window.lingua = {
    ...(window.lingua ?? ({ platform: 'darwin' } as LinguaAPI)),
    projectTerminal: bridge,
  } as LinguaAPI;
}

function resetStore(): void {
  useProjectTerminalStore.setState({
    rootId: null,
    projectName: null,
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

beforeEach(() => {
  dataListener = undefined;
  exitListener = undefined;
  _resetProjectTerminalListenersForTests();
  installBridge();
  resetStore();
  useSettingsStore.setState({ nativeExecutionAcknowledged: true });
  useNativeExecutionGateStore.setState({ pendingLanguage: null, pendingResume: null });
});

describe('projectTerminalStore', () => {
  it('gates the first start behind the native execution acknowledgement', async () => {
    useSettingsStore.setState({ nativeExecutionAcknowledged: false });

    await useProjectTerminalStore.getState().start(bindingA, 100, 30);
    expect(bridge.start).not.toHaveBeenCalled();
    expect(useNativeExecutionGateStore.getState().pendingLanguage).toBe('project-terminal');

    useSettingsStore.setState({ nativeExecutionAcknowledged: true });
    useNativeExecutionGateStore.getState().confirm();
    await vi.waitFor(() => expect(bridge.start).toHaveBeenCalledWith(bindingA.rootId, 100, 30));
    await vi.waitFor(() => expect(useProjectTerminalStore.getState().status).toBe('running'));
  });

  it('preserves PTY output that arrives before start IPC resolves', async () => {
    const pending = deferred<ProjectTerminalStartResult>();
    installBridge({ start: vi.fn().mockReturnValue(pending.promise) });

    const start = useProjectTerminalStore.getState().start(bindingA, 100, 30);
    expect(useProjectTerminalStore.getState().status).toBe('starting');
    dataListener?.({ sessionId: 'early-session', data: 'ready\r\n' });
    pending.resolve({ ok: true, sessionId: 'early-session', shellName: 'zsh' });
    await start;

    expect(useProjectTerminalStore.getState()).toMatchObject({
      status: 'running',
      sessionId: 'early-session',
      shellName: 'zsh',
      bufferChars: 7,
      chunks: [{ sequence: 1, data: 'ready\r\n' }],
    });
  });

  it('bounds retained output while preserving the newest terminal content', async () => {
    await useProjectTerminalStore.getState().start(bindingA, 100, 30);
    const large = 'a'.repeat(2 * 1024 * 1024);
    dataListener?.({ sessionId: 'session-a', data: `discard-${large}` });
    dataListener?.({ sessionId: 'session-a', data: 'newest' });

    const state = useProjectTerminalStore.getState();
    expect(state.bufferChars).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(state.chunks.at(-1)?.data).toBe('newest');
  });

  it('drops a stale start response and stops its native session after a project switch', async () => {
    const pending = deferred<ProjectTerminalStartResult>();
    installBridge({ start: vi.fn().mockReturnValue(pending.promise) });
    const start = useProjectTerminalStore.getState().start(bindingA, 100, 30);

    useProjectTerminalStore.getState().reset(bindingB);
    pending.resolve({ ok: true, sessionId: 'stale-session', shellName: 'bash' });
    await start;

    expect(bridge.stop).toHaveBeenCalledWith('stale-session');
    expect(useProjectTerminalStore.getState()).toMatchObject({
      rootId: bindingB.rootId,
      projectName: 'Beta',
      status: 'idle',
      sessionId: null,
    });
  });

  it('forwards input and resize only while active, then records root revocation', async () => {
    await useProjectTerminalStore.getState().start(bindingA, 100, 30);
    useProjectTerminalStore.getState().write('pwd\r');
    useProjectTerminalStore.getState().resize(120, 40);
    expect(bridge.write).toHaveBeenCalledWith('session-a', 'pwd\r');
    expect(bridge.resize).toHaveBeenCalledWith('session-a', 120, 40);

    exitListener?.({
      sessionId: 'session-a',
      exitCode: null,
      signal: null,
      reason: 'root-revoked',
    });
    expect(useProjectTerminalStore.getState()).toMatchObject({
      status: 'exited',
      sessionId: null,
      exit: { reason: 'root-revoked' },
    });
    useProjectTerminalStore.getState().write('ignored');
    expect(bridge.write).toHaveBeenCalledTimes(1);
  });

  it('surfaces honest unavailability when no desktop bridge exists', async () => {
    window.lingua = { ...(window.lingua as LinguaAPI), projectTerminal: undefined };
    resetStore();
    await useProjectTerminalStore.getState().start(bindingA, 100, 30);
    expect(useProjectTerminalStore.getState()).toMatchObject({
      rootId: bindingA.rootId,
      status: 'unavailable',
    });
  });
});
