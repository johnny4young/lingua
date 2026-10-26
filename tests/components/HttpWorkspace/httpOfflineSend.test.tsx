import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpSendButton } from '../../../src/renderer/components/HttpWorkspace/HttpSendButton';
import { useHttpOfflineSend } from '../../../src/renderer/components/HttpWorkspace/useHttpOfflineSend';
import { useHttpOfflineQueue } from '../../../src/renderer/stores/httpOfflineQueueStore';
import { useUIStore } from '../../../src/renderer/stores/uiStore';
import { useWorkspaceToolStore } from '../../../src/renderer/stores/workspaceToolStore';
import { isLocalNetworkHostname } from '../../../src/renderer/utils/loopbackHost';
import { createBlankHttpRequest, type HttpRequestV1 } from '../../../src/shared/httpWorkspace';

let online = true;
function setOnline(next: boolean) {
  online = next;
  window.dispatchEvent(new Event(next ? 'online' : 'offline'));
}

const request = (id: string, url: string, overrides: Partial<HttpRequestV1> = {}): HttpRequestV1 => ({
  ...createBlankHttpRequest({ id }),
  url,
  ...overrides,
});

beforeEach(() => {
  online = true;
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  useHttpOfflineQueue.setState({ queued: {} });
  useUIStore.setState({ statusNotice: null });
});

afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'onLine');
});

describe('isLocalNetworkHostname', () => {
  it('knows the hosts that answer without the internet', () => {
    for (const host of ['localhost', 'api.localhost', 'printer.local', '127.0.0.1', '127.4.5.6', '10.0.0.8', '172.16.0.1', '172.31.255.255', '192.168.1.20', '169.254.0.1', '[::1]', '[fd12::1]', '[fe80::1]', 'api', 'devbox', 'myapp.test', 'db.internal', 'nas.lan', 'router.home.arpa']) {
      expect(isLocalNetworkHostname(host), host).toBe(true);
    }
    for (const host of ['api.example.com', '172.32.0.1', '8.8.8.8', '[2001:db8::1]', 'localhost.example.com', 'test.example.com', 'lan.io']) {
      expect(isLocalNetworkHostname(host), host).toBe(false);
    }
  });
});

describe('useHttpOfflineSend', () => {
  it('sends straight away while online', () => {
    const send = vi.fn(async () => null);
    const { result } = renderHook(() => useHttpOfflineSend(send));
    result.current.sendFromEditor(request('r1', 'https://api.example.com/users'));
    expect(send).toHaveBeenCalledTimes(1);
    expect(useHttpOfflineQueue.getState().queued).toEqual({});
  });

  it('queues a request to the internet while offline, but sends local, private and streamed ones', () => {
    const send = vi.fn(async () => null);
    const { result } = renderHook(() => useHttpOfflineSend(send));
    act(() => setOnline(false));
    act(() => result.current.sendFromEditor(request('r1', 'https://api.example.com/users')));
    expect(useHttpOfflineQueue.getState().queued).toEqual({ r1: { ready: false } });
    expect(useUIStore.getState().statusNotice).toMatchObject({ messageKey: 'httpWorkspace.offline.queuedRead' });
    expect(result.current.queueFor(request('r1', 'https://api.example.com/users')).state).toBe('queued');
    for (const local of [request('r2', 'http://localhost:3000/'), request('r3', 'http://192.168.1.5/'), request('r4', 'https://api.example.com/events', { transport: 'sse' })]) {
      act(() => result.current.sendFromEditor(local));
    }
    expect(send).toHaveBeenCalledTimes(3);
    expect(Object.keys(useHttpOfflineQueue.getState().queued)).toEqual(['r1']);
    useUIStore.setState({ statusNotice: null });
    act(() => result.current.sendFromEditor(request('r1', 'https://api.example.com/users')));
    expect(useUIStore.getState().statusNotice).toBeNull();
  });

  it('sends what was held when it mounts online, after the connection returned while it was closed', async () => {
    const get = request('get', 'https://api.example.com/users');
    useWorkspaceToolStore.setState({ requests: [get] });
    useHttpOfflineQueue.getState().enqueue('get');
    const send = vi.fn(async () => null);
    await act(async () => {
      renderHook(() => useHttpOfflineSend(send));
    });
    expect(send).toHaveBeenCalledWith(get);
    expect(useHttpOfflineQueue.getState().queued).toEqual({});
  });

  it('sends queued reads by themselves and leaves writes for Send now when the connection returns', async () => {
    const get = request('get', 'https://api.example.com/users');
    const post = request('post', 'https://api.example.com/users', { method: 'POST' });
    useWorkspaceToolStore.setState({ requests: [get, post] });
    const send = vi.fn(async () => null);
    const { result } = renderHook(() => useHttpOfflineSend(send));
    act(() => setOnline(false));
    act(() => {
      result.current.sendFromEditor(get);
      result.current.sendFromEditor(post);
    });
    expect(useUIStore.getState().statusNotice).toMatchObject({ messageKey: 'httpWorkspace.offline.queuedWrite' });
    await act(async () => setOnline(true));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(get);
    expect(useHttpOfflineQueue.getState().queued).toEqual({ post: { ready: true } });
    expect(useUIStore.getState().statusNotice).toMatchObject({ messageKey: 'httpWorkspace.offline.waiting', values: { count: 1 } });
    act(() => result.current.sendFromEditor(post));
    expect(send).toHaveBeenLastCalledWith(post);
    expect(useHttpOfflineQueue.getState().queued).toEqual({});
  });

  it('skips an entry removed while an earlier one was sending', async () => {
    const first = request('first', 'https://api.example.com/a');
    const second = request('second', 'https://api.example.com/b');
    useWorkspaceToolStore.setState({ requests: [first, second] });
    useHttpOfflineQueue.getState().enqueue('first');
    useHttpOfflineQueue.getState().enqueue('second');
    const send = vi.fn(async () => {
      useHttpOfflineQueue.getState().remove('second');
      return null;
    });
    await act(async () => {
      renderHook(() => useHttpOfflineSend(send));
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(first);
  });

  it('keeps Run chain on a queued send', async () => {
    const get = request('get', 'https://api.example.com/users');
    useWorkspaceToolStore.setState({ requests: [get] });
    const send = vi.fn(async () => null);
    const { result } = renderHook(() => useHttpOfflineSend(send));
    act(() => setOnline(false));
    act(() => result.current.sendFromEditor(get, { forceChain: true }));
    expect(useHttpOfflineQueue.getState().queued).toEqual({ get: { ready: false, forceChain: true } });
    await act(async () => setOnline(true));
    expect(send).toHaveBeenCalledWith(get, { forceChain: true });
  });

  it('drops a queued entry whose request was deleted', async () => {
    useWorkspaceToolStore.setState({ requests: [] });
    const send = vi.fn(async () => null);
    renderHook(() => useHttpOfflineSend(send));
    act(() => setOnline(false));
    useHttpOfflineQueue.getState().enqueue('gone');
    await act(async () => setOnline(true));
    expect(send).not.toHaveBeenCalled();
    expect(useHttpOfflineQueue.getState().queued).toEqual({});
  });

  it('keeps draining after a send throws', async () => {
    const first = request('first', 'https://api.example.com/a');
    const second = request('second', 'https://api.example.com/b');
    useWorkspaceToolStore.setState({ requests: [first, second] });
    useHttpOfflineQueue.getState().enqueue('first');
    useHttpOfflineQueue.getState().enqueue('second');
    const send = vi.fn(async (candidate: HttpRequestV1) => {
      if (candidate.id === first.id) throw new Error('chain setup failed');
      return null;
    });
    await act(async () => {
      renderHook(() => useHttpOfflineSend(send));
    });
    expect(send.mock.calls.map(([candidate]) => candidate.id)).toEqual([first.id, second.id]);
    expect(useHttpOfflineQueue.getState().queued).toEqual({});
  });

  it('stops a drain whose panel unmounted before taking new entries', async () => {
    const first = request('first', 'https://api.example.com/a');
    const second = request('second', 'https://api.example.com/b');
    useWorkspaceToolStore.setState({ requests: [first, second] });
    useHttpOfflineQueue.getState().enqueue('first');
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const send = vi.fn(async (candidate: HttpRequestV1) => {
      if (candidate.id === first.id) await pending;
      return null;
    });
    let unmount!: () => void;
    await act(async () => {
      ({ unmount } = renderHook(() => useHttpOfflineSend(send)));
    });
    unmount();
    useHttpOfflineQueue.getState().enqueue('second');
    await act(async () => release());
    expect(send.mock.calls.map(([candidate]) => candidate.id)).toEqual([first.id]);
    expect(useHttpOfflineQueue.getState().queued).toEqual({ second: { ready: false } });
  });
});

describe('offline entries arriving around a pending replay', () => {
  const methods = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

  for (const timing of ['before-drain', 'during-drain', 'after-drain'] as const) {
    it.each(methods)(`${timing}: resumes or readies %s after reconnect`, async (method) => {
      const first = request('first', 'https://qa.example.invalid/first');
      const second = request('second', 'https://qa.example.invalid/second', { method });
      useWorkspaceToolStore.setState({ requests: [first, second] });
      setOnline(false);
      let release!: () => void;
      const pending = new Promise<void>((resolve) => { release = resolve; });
      const send = vi.fn(async (candidate: HttpRequestV1) => {
        if (candidate.id === first.id) await pending;
        return null;
      });
      const { result } = renderHook(() => useHttpOfflineSend(send));
      await act(async () => {
        result.current.sendFromEditor(first);
        if (timing === 'before-drain') result.current.sendFromEditor(second);
      });
      await act(async () => setOnline(true));
      expect(send.mock.calls.map(([candidate]) => candidate.id)).toEqual([first.id]);
      if (timing === 'after-drain') await act(async () => release());
      if (timing !== 'before-drain') {
        await act(async () => setOnline(false));
        await act(async () => result.current.sendFromEditor(second));
        expect(useHttpOfflineQueue.getState().queued[second.id]).toEqual({ ready: false });
        await act(async () => setOnline(true));
      }
      if (timing !== 'after-drain') {
        // Still one at a time: nothing else goes out while the first send is pending.
        expect(send.mock.calls.map(([candidate]) => candidate.id)).toEqual([first.id]);
        await act(async () => release());
      }
      const read = ['GET', 'HEAD', 'OPTIONS'].includes(method);
      expect(send.mock.calls.map(([candidate]) => candidate.id)).toEqual(read ? [first.id, second.id] : [first.id]);
      expect(useHttpOfflineQueue.getState().queued).toEqual(read ? {} : { [second.id]: { ready: true } });
    });
  }
});

describe('HttpSendButton', () => {
  const base = { isExecuting: false, disabled: false, combo: '⌘↵', onSend: vi.fn() };

  it('labels each queue state', () => {
    const onRemove = vi.fn();
    const { rerender } = render(<HttpSendButton {...base} queue={{ willQueue: true, state: null, onRemove }} />);
    expect(screen.getByTestId('http-request-editor-send').textContent).toBe('Send when online');
    rerender(<HttpSendButton {...base} queue={{ willQueue: false, state: 'ready', onRemove }} />);
    expect(screen.getByTestId('http-request-editor-send').textContent).toBe('Send now');
    rerender(<HttpSendButton {...base} queue={{ willQueue: true, state: 'queued', onRemove }} />);
    expect(screen.getByTestId('http-request-editor-queued').textContent).toContain('Queued');
    fireEvent.click(screen.getByRole('button', { name: 'Remove from the queue' }));
    expect(onRemove).toHaveBeenCalled();
    rerender(<HttpSendButton {...base} />);
    expect(screen.getByTestId('http-request-editor-send').textContent).toBe('Send');
  });
});
