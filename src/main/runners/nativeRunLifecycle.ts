/** Resource ownership for native preparation and child processes. */
import type { ChildProcess } from 'node:child_process';
import { killProcessTree } from './processTree';
import { onOwnerReset, type ResettableOwner } from './ownerReset';

export const NATIVE_RUN_OWNER_GONE = Symbol('native-run-owner-gone');

interface RunOwner extends ResettableOwner {
  isDestroyed(): boolean;
}
interface OwnerRuns {
  controllers: Set<AbortController>;
  unsubscribe: () => void;
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
    // A reload keeps the WebContents, but the document that owned these runs is gone.
    const unsubscribe = onOwnerReset(owner, () => {
      for (const active of group) active.abort(NATIVE_RUN_OWNER_GONE);
      // Abort is one-shot: upgrade a previous graceful Stop as well.
      const signals = new Set([...group].map(active => active.signal));
      for (const [child, signal] of children) {
        if (signal && signals.has(signal)) killProcessTree(child, 'SIGKILL');
      }
    });
    owned = { controllers: group, unsubscribe };
    owners.set(owner, owned);
  }
  owned?.controllers.add(controller);
  if (owner?.isDestroyed()) controller.abort(NATIVE_RUN_OWNER_GONE);
  return {
    controller,
    release: () => {
      controllers.delete(controller);
      owned?.controllers.delete(controller);
      if (owner && owned?.controllers.size === 0) {
        owned.unsubscribe();
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

/** Shutdown cannot rely on escalation timers running after Electron exits. */
export function disposeNativeRuns(): void {
  for (const controller of controllers) controller.abort(NATIVE_RUN_OWNER_GONE);
  for (const child of children.keys()) killProcessTree(child, 'SIGKILL');
}
