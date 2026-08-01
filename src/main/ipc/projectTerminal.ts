/** Capability- and owner-bound IPC for the desktop project terminal. */

import type { WebContents } from 'electron';
import {
  disposeProjectTerminalSessionsForOwner,
  resizeProjectTerminal,
  startProjectTerminal,
  stopProjectTerminal,
  writeProjectTerminal,
} from '../projectTerminal';
import { resolveCapabilityPath } from './projectCapabilities';
import { typedHandle } from './typedHandle';

const observedOwners = new WeakSet<WebContents>();

function observeOwner(sender: WebContents): void {
  if (observedOwners.has(sender)) return;
  observedOwners.add(sender);
  sender.once('destroyed', () => {
    disposeProjectTerminalSessionsForOwner(sender.id);
  });
}

function sendIfAlive(
  sender: WebContents,
  channel: 'project-terminal:data' | 'project-terminal:exit',
  payload: unknown
): void {
  if (sender.isDestroyed()) return;
  try {
    sender.send(channel, payload);
  } catch {
    // Renderer teardown can race the last PTY event after isDestroyed().
  }
}

export function registerProjectTerminalHandlers(): void {
  typedHandle(
    'project-terminal:start',
    async (event, rootId: unknown, columns: unknown, rows: unknown) => {
      const resolved = await resolveCapabilityPath(rootId, '', 'read');
      if (!resolved.ok || typeof rootId !== 'string') {
        throw new Error(
          `Project terminal root rejected: ${resolved.ok ? 'unknown-root' : resolved.error}`
        );
      }
      const sender = event.sender;
      if (sender.isDestroyed()) {
        return { ok: false, reason: 'spawn-failed' } as const;
      }
      observeOwner(sender);
      const result = await startProjectTerminal(
        rootId,
        resolved.absolutePath,
        sender.id,
        columns,
        rows,
        {
          onData: payload => {
            sendIfAlive(sender, 'project-terminal:data', payload);
          },
          onExit: payload => {
            sendIfAlive(sender, 'project-terminal:exit', payload);
          },
        }
      );
      if (sender.isDestroyed() && result.ok) {
        stopProjectTerminal(result.sessionId, sender.id);
        return { ok: false, reason: 'spawn-failed' } as const;
      }
      return result;
    }
  );

  typedHandle('project-terminal:write', (event, sessionId: unknown, data: unknown) => ({
    written: writeProjectTerminal(sessionId, event.sender.id, data),
  }));

  typedHandle(
    'project-terminal:resize',
    (event, sessionId: unknown, columns: unknown, rows: unknown) => ({
      resized: resizeProjectTerminal(
        sessionId,
        event.sender.id,
        columns,
        rows
      ),
    })
  );

  typedHandle('project-terminal:stop', (event, sessionId: unknown) => ({
    stopped: stopProjectTerminal(sessionId, event.sender.id),
  }));
}
