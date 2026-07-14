/**
 * Shared request/response outcome for operational IPC failures.
 *
 * Capability-sandbox violations remain exceptional and may throw. Expected
 * runtime failures cross the Electron boundary through this discriminated
 * union so renderer callers must handle both branches explicitly.
 */
export type Result<T, E = string> =
  | { ok: true; data: T }
  | { ok: false; reason: E; message?: string };
