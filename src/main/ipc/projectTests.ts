/** Capability-bound IPC bridge for the desktop project test runner. */

import type { WebContents } from 'electron';
import { detectProjectTests, emptyProjectTestRunResult, runProjectTests } from '../projectTests';
import { isProjectTestFramework, isProjectTestRunId } from '../../shared/projectTests';
import { resolveCapabilityPath } from './projectCapabilities';
import { typedHandle } from './typedHandle';

interface OwnedRequest {
  rootId: string;
  controller: AbortController;
}

// Main owns execution only after authorization; this entry reservation owns
// cancellation while that authorization is still awaiting the filesystem.
const requests = new WeakMap<WebContents, Map<string, OwnedRequest>>();

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
    async (event, rootId: unknown, framework: unknown, runId: unknown) => {
      if (typeof rootId !== 'string' || !isProjectTestFramework(framework) || !isProjectTestRunId(runId)) {
        return emptyProjectTestRunResult('invalid-request', null);
      }
      const sender = event.sender;
      const owned = requests.get(sender) ?? new Map<string, OwnedRequest>();
      if (owned.has(runId)) return emptyProjectTestRunResult('invalid-request', framework);
      const ownerLifecycle = new AbortController();
      const request = { rootId, controller: ownerLifecycle };
      owned.set(runId, request);
      requests.set(sender, owned);
      const stopOnSenderDestroyed = () => ownerLifecycle.abort();
      if (sender.isDestroyed()) ownerLifecycle.abort();
      else sender.once('destroyed', stopOnSenderDestroyed);
      try {
        const rootPath = await authorizedProjectRoot(rootId);
        if (ownerLifecycle.signal.aborted) return emptyProjectTestRunResult('stopped', framework);
        return await runProjectTests(rootPath, framework, runId, {
          signal: ownerLifecycle.signal,
          onOutput: (stream, chunk) => {
            if (ownerLifecycle.signal.aborted || sender.isDestroyed()) return;
            try {
              sender.send('project-tests:output', { runId, stream, chunk });
            } catch {
              // A frame can disappear before WebContents emits destroyed.
              ownerLifecycle.abort();
            }
          },
        });
      } finally {
        ownerLifecycle.abort();
        sender.removeListener('destroyed', stopOnSenderDestroyed);
        if (owned.get(runId) === request) owned.delete(runId);
        if (owned.size === 0) requests.delete(sender);
      }
    }
  );

  typedHandle('project-tests:stop', async (event, rootId: unknown, runId: unknown) => {
    const request = isProjectTestRunId(runId) ? requests.get(event.sender)?.get(runId) : undefined;
    const owned = request?.rootId === rootId ? request : undefined;
    // Cancellation only removes this sender's own authority and must not wait
    // behind filesystem authorization. Root validity is still checked before
    // returning, and an unrelated sender/root can never stop this request.
    owned?.controller.abort();
    await authorizedProjectRoot(rootId);
    return { stopped: owned !== undefined };
  });
}
