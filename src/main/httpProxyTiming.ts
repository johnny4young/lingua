/**
 * Phase timing for one proxied hop. The connector wrapper marks when the
 * socket was asked for, when TCP connected and when it was ready to use (after
 * the TLS handshake on https); the proxy marks the lookup, the response
 * headers and the end of the body.
 */

import type { Socket } from 'node:net';
import type { buildConnector } from 'undici';
import type { HttpResponseTiming } from '../shared/httpWorkspaceSchema';

/** performance.now() marks for one hop. */
export interface HopMarks {
  start: number;
  lookupDone?: number;
  connectStart?: number;
  tcp?: number;
  ready?: number;
  headers?: number;
  done?: number;
}

/** Wraps a connector so `marks` records the socket's connect and ready times. */
export function timeConnector(
  connect: buildConnector.connector,
  marks: HopMarks,
  now: () => number = () => performance.now()
): buildConnector.connector {
  return (options, callback) => {
    marks.connectStart = now();
    // undici's connector returns the socket it opened, although its type says void.
    const socket = connect(options, (...args) => {
      if (args[0] === null) marks.ready = now();
      callback(...args);
    }) as unknown as Socket | undefined;
    // The callback fires after the TLS handshake; the socket's own connect event marks TCP alone.
    socket?.once?.('connect', () => {
      marks.tcp ??= now();
    });
  };
}

const ms = (value: number) => Math.max(0, Math.round(value));

/** The timing of a hop whose marks are complete, or undefined when one is missing. */
export function hopTiming(marks: HopMarks, redirects: number, redirectMs: number): HttpResponseTiming | undefined {
  const { start, lookupDone, connectStart, ready, headers, done } = marks;
  if (lookupDone === undefined || connectStart === undefined || ready === undefined || headers === undefined || done === undefined) {
    return undefined;
  }
  const tcp = Math.min(marks.tcp ?? ready, ready);
  return {
    dnsMs: ms(lookupDone - start),
    connectMs: ms(tcp - connectStart),
    tlsMs: ms(ready - tcp),
    waitingMs: ms(headers - ready),
    downloadMs: ms(done - headers),
    redirects,
    redirectMs: ms(redirectMs),
  };
}
