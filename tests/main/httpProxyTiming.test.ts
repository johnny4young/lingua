import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { hopTiming, timeConnector, type HopMarks } from '../../src/main/httpProxyTiming';

function clock(...times: number[]) {
  const now = vi.fn<() => number>();
  for (const time of times) now.mockReturnValueOnce(time);
  return now;
}

const options = { hostname: 'api.example.com', protocol: 'https:', port: '443' };

describe('timeConnector', () => {
  it('marks TCP on the socket connect event and readiness on the connector callback', () => {
    const marks: HopMarks = { start: 0 };
    const socket = new EventEmitter();
    let finish: (() => void) | undefined;
    const callback = vi.fn();
    const connector = timeConnector(
      (_options, done) => {
        finish = () => done(null, socket as never);
        return socket as never;
      },
      marks,
      clock(10, 14, 30)
    );
    connector(options, callback);
    socket.emit('connect');
    finish?.();
    expect(marks).toMatchObject({ connectStart: 10, tcp: 14, ready: 30 });
    expect(callback).toHaveBeenCalledWith(null, socket);
  });

  it('leaves readiness unset when the connection fails', () => {
    const marks: HopMarks = { start: 0 };
    const error = new Error('refused');
    const callback = vi.fn();
    timeConnector((_options, done) => done(error, null), marks, clock(5))(options, callback);
    expect(marks.ready).toBeUndefined();
    expect(callback).toHaveBeenCalledWith(error, null);
  });
});

describe('hopTiming', () => {
  it('splits the hop into lookup, TCP, TLS, waiting and download', () => {
    const marks: HopMarks = { start: 100, lookupDone: 103, connectStart: 104, tcp: 109, ready: 121, headers: 160, done: 172.6 };
    expect(hopTiming(marks, 1, 40.4)).toEqual({ dnsMs: 3, connectMs: 5, tlsMs: 12, waitingMs: 39, downloadMs: 13, redirects: 1, redirectMs: 40 });
  });

  it('counts no TLS when the socket was ready as it connected, and gives nothing without a connection', () => {
    expect(hopTiming({ start: 0, lookupDone: 1, connectStart: 1, ready: 4, headers: 9, done: 10 }, 0, 0)).toMatchObject({ connectMs: 3, tlsMs: 0 });
    expect(hopTiming({ start: 0, lookupDone: 1, headers: 9, done: 10 }, 0, 0)).toBeUndefined();
  });
});
