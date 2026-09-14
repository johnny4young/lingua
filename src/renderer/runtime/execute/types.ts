import type { TelemetryTrack } from '../../hooks/useTelemetry';
import type { Language } from '../../types/language';

export interface ManualExecutionLifecycle {
  setIsRunning?: (value: boolean) => void;
  setIsInitializing?: (value: boolean) => void;
  setLoadingMessage?: (value: string | null) => void;
  setCurrentLanguage?: (language: Language | null) => void;
  /**
   * Defaults to true. Replay surfaces pass false so executing a captured
   * history snapshot does not append another entry to the same timeline.
   */
  recordHistory?: boolean;
  /**
   * internal — opt-in override for the runner's deadline (ms). Used by
   * the desktop smoke timeout cases so the parent kill timer fires
   * within a few seconds instead of the language default. End-user
   * surfaces leave this undefined and inherit each runner's default.
   */
  executionTimeoutMs?: number;
  /**
   * Explicit JS/TS debug intent. Normal manual runs leave this false so
   * breakpoints remain passive editor marks until the user presses Debug.
   */
  debug?: boolean;
  /** Telemetry entry point supplied by the React control that owns the run. */
  track?: TelemetryTrack;
}

export interface ManualExecutionSummary {
  mode: 'run' | 'validate' | 'view';
  ok: boolean;
  cancelled?: boolean;
  executionTime: number | null;
  diagnosticsCount: number;
  message: string;
  /** Number of console entries emitted by this execution orchestrator. */
  consoleEntryCount?: number;
}
