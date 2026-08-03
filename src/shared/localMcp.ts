import type { RootId } from './fs/brandedIds';

export const LOCAL_MCP_TOOL_NAMES = [
  'lingua_project_info',
  'lingua_list_files',
  'lingua_read_file',
  'lingua_search_project',
] as const;

export type LocalMcpToolName = (typeof LOCAL_MCP_TOOL_NAMES)[number];

export type LocalMcpStopReason =
  | 'app-quit'
  | 'owner-destroyed'
  | 'project-revoked'
  | 'replaced'
  | 'user';

export type LocalMcpStartFailureReason =
  | 'invalid-acknowledgement'
  | 'invalid-project'
  | 'listen-failed'
  | 'owner-destroyed';

interface LocalMcpStoppedState {
  readonly status: 'stopped';
  readonly reason?: LocalMcpStopReason;
}

export interface LocalMcpRunningState {
  readonly status: 'running';
  readonly endpoint: string;
  /** Session-only bearer token. Never persisted or logged. */
  readonly accessToken: string;
  readonly projectName: string;
  readonly startedAt: string;
  readonly requestCount: number;
  readonly toolCallCount: number;
  readonly tools: readonly LocalMcpToolName[];
}

export type LocalMcpState = LocalMcpStoppedState | LocalMcpRunningState;

export type LocalMcpStartResult =
  | { readonly ok: true; readonly state: LocalMcpRunningState }
  | { readonly ok: false; readonly reason: LocalMcpStartFailureReason };

export interface LocalMcpBridge {
  getState: () => Promise<LocalMcpState>;
  start: (
    rootId: RootId,
    acknowledgement: { readonly readOnlySourceAccess: true }
  ) => Promise<LocalMcpStartResult>;
  stop: () => Promise<LocalMcpState>;
  onStateChanged: (handler: (state: LocalMcpState) => void) => () => void;
}
