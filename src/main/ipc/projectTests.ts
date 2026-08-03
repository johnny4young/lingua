/** Capability-bound IPC bridge for the desktop project test runner. */

import { detectProjectTests, runProjectTests, stopProjectTests } from '../projectTests';
import { resolveCapabilityPath } from './projectCapabilities';
import { typedHandle } from './typedHandle';

async function authorizedProjectRoot(rootId: unknown): Promise<string> {
  const resolved = await resolveCapabilityPath(rootId, '', 'read');
  if (!resolved.ok) {
    throw new Error(`Project test root rejected: ${resolved.error}`);
  }
  return resolved.absolutePath;
}

export function registerProjectTestHandlers(): void {
  typedHandle('project-tests:detect', async (_event, rootId: unknown) => {
    const rootPath = await authorizedProjectRoot(rootId);
    return detectProjectTests(rootPath);
  });

  typedHandle(
    'project-tests:run',
    async (_event, rootId: unknown, framework: unknown, runId: unknown) => {
      const rootPath = await authorizedProjectRoot(rootId);
      const sender = _event.sender;
      const ownerLifecycle = new AbortController();
      const stopOnSenderDestroyed = () => ownerLifecycle.abort();
      sender.once('destroyed', stopOnSenderDestroyed);
      try {
        return await runProjectTests(rootPath, framework, runId, {
          signal: ownerLifecycle.signal,
          onOutput: (stream, chunk) => {
            if (typeof runId !== 'string' || sender.isDestroyed()) return;
            sender.send('project-tests:output', { runId, stream, chunk });
          },
        });
      } finally {
        sender.removeListener('destroyed', stopOnSenderDestroyed);
      }
    }
  );

  typedHandle('project-tests:stop', async (_event, rootId: unknown, runId: unknown) => {
    const rootPath = await authorizedProjectRoot(rootId);
    return { stopped: stopProjectTests(rootPath, runId) };
  });
}
