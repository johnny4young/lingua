/** Resource ownership for native preparation and child processes. */
import type { ChildProcess } from 'node:child_process';
import { killProcessTree } from './processTree';

export const NATIVE_RUN_OWNER_GONE = Symbol('native-run-owner-gone');

interface RunOwner {
  isDestroyed(): boolean;
  once(event: 'destroyed', listener: () => void): unknown;
  removeListener(event: 'destroyed', listener: () => void): unknown;
}
interface OwnerRuns {
  controllers: Set<AbortController>;
  destroyed: () => void;
}
const owners = new WeakMap<RunOwner, OwnerRuns>();
const controllers = new Set<AbortController>();
const children = new Map<ChildProcess, AbortSignal | undefined>();

/** Unlabelled runs are tracked too; an optional owner permits main-only callers. */
export function createNativeRunLifecycle(owner?: RunOwner): {
  controller: AbortController;
  release: () => void;
} {
  const controller = new AbortController();
  controllers.add(controller);
  let owned = owner ? owners.get(owner) : undefined;
  if (owner && !owned && !owner.isDestroyed()) {
    const group = new Set<AbortController>();
    owned = { controllers: group, destroyed: () => {
      for (const active of group) active.abort(NATIVE_RUN_OWNER_GONE);
      // Abort is one-shot: upgrade a previous graceful Stop as well.
      const signals = new Set([...group].map(active => active.signal));
      for (const [child, signal] of children) {
        if (signal && signals.has(signal)) killProcessTree(child, 'SIGKILL');
      }
    } };
    owners.set(owner, owned);
    owner.once('destroyed', owned.destroyed);
  }
  owned?.controllers.add(controller);
  if (owner?.isDestroyed()) controller.abort(NATIVE_RUN_OWNER_GONE);
  return {
    controller,
    release: () => {
      controllers.delete(controller);
      owned?.controllers.delete(controller);
      if (owner && owned?.controllers.size === 0) {
        owner.removeListener('destroyed', owned.destroyed);
        if (owners.get(owner) === owned) owners.delete(owner);
      }
    },
  };
}

/** Track until close/error, not until Stop: a child may ignore SIGTERM. */
export function trackNativeRunProcess(child: ChildProcess, signal?: AbortSignal): () => void {
  children.set(child, signal);
  return () => { children.delete(child); };
}

/** before-quit cannot rely on escalation timers running after Electron exits. */
export function disposeNativeRuns(): void {
  for (const controller of controllers) controller.abort(NATIVE_RUN_OWNER_GONE);
  for (const child of children.keys()) killProcessTree(child, 'SIGKILL');
}
