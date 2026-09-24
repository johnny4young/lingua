/** Ownership for native-debugger work before a protocol session exists. */
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import type { WebContents } from 'electron';
import {
  createNativeRunLifecycle,
  NATIVE_RUN_OWNER_GONE,
} from '../runners/nativeRunLifecycle';

const MAX_DEBUGGER_SESSION_ID_LENGTH = 128;

interface PreparationEntry {
  readonly id: string;
  readonly ownerId: number;
  readonly controller: AbortController;
  cleanupPath: string | null;
  finish: () => void;
}

export interface DebuggerPreparation {
  readonly id: string;
  readonly signal: AbortSignal;
  readonly setCleanupPath: (path: string) => void;
  readonly finish: () => void;
}

function isDebuggerSessionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_DEBUGGER_SESSION_ID_LENGTH &&
    /^[A-Za-z0-9_-]+$/u.test(value)
  );
}

/**
 * Maps an IPC-visible transient identity to its owner-bound cancellation signal.
 * A preparation remains reserved until it either fails or transfers into the
 * runtime-specific session map, so Stop and duplicate starts have one answer.
 */
export class DebuggerPreparationRegistry {
  private readonly active = new Map<string, PreparationEntry>();

  reserve(
    owner: WebContents,
    requestedId: unknown,
    conflicts: (id: string) => boolean
  ): DebuggerPreparation | null {
    const id = requestedId === undefined ? randomUUID() : requestedId;
    if (!isDebuggerSessionId(id) || this.active.has(id) || conflicts(id)) return null;

    const lifecycle = createNativeRunLifecycle(owner);
    const entry: PreparationEntry = {
      id,
      ownerId: owner.id,
      controller: lifecycle.controller,
      cleanupPath: null,
      finish: () => undefined,
    };
    let finished = false;
    entry.finish = () => {
      if (finished) return;
      finished = true;
      if (this.active.get(id) === entry) this.active.delete(id);
      lifecycle.release();
    };
    this.active.set(id, entry);
    return {
      id,
      signal: entry.controller.signal,
      setCleanupPath: cleanupPath => {
        if (this.active.get(id) === entry) entry.cleanupPath = cleanupPath;
      },
      finish: entry.finish,
    };
  }

  stop(ownerId: number, value: unknown): string | null {
    if (!isDebuggerSessionId(value)) return null;
    const entry = this.active.get(value);
    if (!entry || entry.ownerId !== ownerId) return null;
    entry.controller.abort();
    return entry.id;
  }

  disposeAll(): void {
    for (const entry of [...this.active.values()]) {
      entry.controller.abort(NATIVE_RUN_OWNER_GONE);
      if (entry.cleanupPath) {
        try {
          rmSync(entry.cleanupPath, { recursive: true, force: true });
        } catch {
          // Async preparation also retries cleanup in its finally block.
        }
      }
      entry.finish();
    }
  }
}
