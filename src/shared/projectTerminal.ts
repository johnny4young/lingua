/** Wire contracts for the desktop project-scoped interactive terminal. */

import type { RootId } from './fs/brandedIds';

export type ProjectTerminalStartFailureReason =
  | 'invalid-dimensions'
  | 'session-limit'
  | 'shell-not-found'
  | 'spawn-failed';

export type ProjectTerminalStartResult =
  | {
      readonly ok: true;
      readonly sessionId: string;
      readonly shellName: string;
    }
  | {
      readonly ok: false;
      readonly reason: ProjectTerminalStartFailureReason;
    };

export interface ProjectTerminalDataEvent {
  readonly sessionId: string;
  readonly data: string;
}

export interface ProjectTerminalExitEvent {
  readonly sessionId: string;
  readonly exitCode: number | null;
  readonly signal: number | null;
  readonly reason: 'exited' | 'stopped' | 'root-revoked' | 'owner-destroyed' | 'app-quit';
}

export interface ProjectTerminalBridge {
  start: (rootId: RootId, columns: number, rows: number) => Promise<ProjectTerminalStartResult>;
  write: (sessionId: string, data: string) => Promise<{ written: boolean }>;
  resize: (sessionId: string, columns: number, rows: number) => Promise<{ resized: boolean }>;
  stop: (sessionId: string) => Promise<{ stopped: boolean }>;
  onData: (handler: (event: ProjectTerminalDataEvent) => void) => () => void;
  onExit: (handler: (event: ProjectTerminalExitEvent) => void) => () => void;
}
