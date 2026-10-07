import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { installDirtyCloseGuard } from '../../src/main/windowCloseGuard';

function fakeWindow() {
  const window = new EventEmitter() as EventEmitter & {
    webContents: EventEmitter & { send: ReturnType<typeof vi.fn> };
  };
  window.webContents = Object.assign(new EventEmitter(), { send: vi.fn() });
  return window;
}

function close(window: ReturnType<typeof fakeWindow>): boolean {
  const event = { preventDefault: vi.fn() };
  window.emit('close', event);
  return event.preventDefault.mock.calls.length === 0;
}

describe('installDirtyCloseGuard', () => {
  it('asks the renderer before closing a healthy window', () => {
    const window = fakeWindow();
    installDirtyCloseGuard(window as never, () => false);
    expect(close(window)).toBe(false);
    expect(window.webContents.send).toHaveBeenCalledWith('app:before-close');
  });

  it('lets a window with a crashed renderer close without leaking the bypass to later windows', () => {
    const crashed = fakeWindow();
    installDirtyCloseGuard(crashed as never, () => false);
    crashed.webContents.emit('render-process-gone');
    expect(close(crashed)).toBe(true);
    expect(crashed.webContents.send).not.toHaveBeenCalled();

    const next = fakeWindow();
    installDirtyCloseGuard(next as never, () => false);
    expect(close(next)).toBe(false);
    expect(next.webContents.send).toHaveBeenCalledWith('app:before-close');
  });

  it('honours the caller bypass for quits and unloaded windows', () => {
    const window = fakeWindow();
    installDirtyCloseGuard(window as never, () => true);
    expect(close(window)).toBe(true);
  });
});
