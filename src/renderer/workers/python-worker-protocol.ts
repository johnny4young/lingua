import type {
  DependencyInstallFailureReason,
  DependencyInstallOutcome,
} from '../../shared/dependencies/types';
import type { WorkerResponse } from '../types/execution';

export interface PythonWorkerInitMessage {
  type: 'init';
}

export interface PythonWorkerResetScopeMessage {
  type: 'reset-scope';
  scopeId?: string;
}

export interface PythonWorkerExecuteMessage {
  type: 'execute';
  runId: string;
  code: string;
  userEnv?: Record<string, string>;
  resultTruncationMarker?: string;
  scopeId?: string;
  stdin?: string;
  captureScope?: boolean;
  scopeDepth?: number;
  richConsoleEnabled?: boolean;
  sourceMappingEnabled?: boolean;
}

export interface PythonWorkerListLoadedMessage {
  type: 'dependencies:list-loaded';
  requestId: string;
}

export interface PythonWorkerInstallMessage {
  type: 'dependencies:install';
  runId: string;
  specifiers: readonly string[];
}

export type PythonWorkerExecutionMessage =
  | PythonWorkerInitMessage
  | PythonWorkerResetScopeMessage
  | PythonWorkerExecuteMessage;

export type PythonWorkerDependencyMessage =
  | PythonWorkerListLoadedMessage
  | PythonWorkerInstallMessage;

/** Every message accepted by the persistent Pyodide worker. */
export type PythonWorkerInboundMessage =
  | PythonWorkerExecutionMessage
  | PythonWorkerDependencyMessage;

export type PythonInstallResultStatus = 'installed' | 'failed' | 'cancelled' | 'skipped-preflight';

export type PythonWorkerDependencyResponse =
  | {
      type: 'dependencies:list-loaded:reply';
      requestId: string;
      packages: readonly string[];
    }
  | {
      type: 'dependencies:install:log';
      runId: string;
      stream: 'stdout' | 'stderr';
      chunk: string;
    }
  | {
      type: 'dependencies:install:done';
      runId: string;
      statuses: Record<string, PythonInstallResultStatus>;
      outcome: DependencyInstallOutcome;
      failureReason: DependencyInstallFailureReason | null;
    };

export type PythonWorkerOutboundMessage = WorkerResponse | PythonWorkerDependencyResponse;

export interface PythonWorkerPort {
  postMessage(message: PythonWorkerOutboundMessage): void;
}
