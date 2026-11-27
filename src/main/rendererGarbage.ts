import type { WebContents } from 'electron';

const COLLECT_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), timeoutMs);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Collects garbage in the page isolate and in every worker isolate of a
 * renderer, so a footprint read afterwards counts retained memory only.
 * Resolves the number of isolates collected, or null when it could not attach.
 */
export async function collectRendererGarbage(contents: WebContents): Promise<number | null> {
  const devtools = contents.debugger;
  if (devtools.isAttached()) return null;

  const workerSessions = new Set<string>();
  const onMessage = (_event: unknown, method: string, params: { sessionId?: unknown }) => {
    if (method === 'Target.attachedToTarget' && typeof params?.sessionId === 'string') {
      workerSessions.add(params.sessionId);
    }
  };

  try {
    devtools.attach('1.3');
  } catch {
    return null;
  }
  devtools.on('message', onMessage);
  try {
    // Existing workers are announced before this command resolves.
    await withTimeout(
      devtools.sendCommand('Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
      }),
      COLLECT_TIMEOUT_MS
    );
    const collected = await Promise.all(
      [undefined, ...workerSessions].map(sessionId =>
        withTimeout(
          devtools.sendCommand('HeapProfiler.collectGarbage', {}, sessionId),
          COLLECT_TIMEOUT_MS
        ).then(
          () => true,
          () => false
        )
      )
    );
    return collected.filter(Boolean).length;
  } catch {
    return null;
  } finally {
    devtools.off('message', onMessage);
    try {
      devtools.detach();
    } catch {
      // The renderer went away mid-collection; nothing is left attached.
    }
  }
}
