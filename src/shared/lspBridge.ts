import type { Result } from './result';
import type { RootId, RelativePath } from './fs/brandedIds';
import type { RustAnalyzerStatus, GoplsStatus } from './lspLauncherTypes';

export interface LspNotification<P = unknown> {
  jsonrpc: '2.0';
  method: string;
  params?: P;
}
type LspRequestFailureReason = 'unsupported-method' | 'not-started' | 'request-failed';
export type LspRequestResult = Result<unknown, LspRequestFailureReason>;
interface LanguageLspBridge<Status> {
  start: (rootId?: RootId) => Promise<Status>;
  restart: () => Promise<Status>;
  stop: () => Promise<{ kind: 'stopped' }>;
  status: () => Promise<Status>;
  request: (method: string, params: unknown) => Promise<LspRequestResult>;
  notify: (method: string, params: unknown) => void;
  onNotification: (callback: (notification: LspNotification) => void) => () => void;
  onStatusChanged: (callback: (status: Status) => void) => () => void;
}
/** Main owns the project grant. Resolved targets never broaden that grant. */
export interface LspBridge {
  resolveTarget: (rootId: RootId, uri: string) => Promise<RelativePath | null>;
  rust: LanguageLspBridge<RustAnalyzerStatus>;
  go: LanguageLspBridge<GoplsStatus>;
}
