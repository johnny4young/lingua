/**
 * IT2-D3 — live runtime-bootstrap progress.
 *
 * The Pyodide / Ruby workers stream `bootstrap-progress` messages while
 * their WASM asset downloads; the runner writes them here and the
 * initialization window in `executeTabManually` subscribes to compose
 * the live "Loading Python runtime… 34 MB / 60 MB" message. Session
 * state only — cleared as soon as the runner finishes preparing.
 */

import { create } from 'zustand';

export interface BootstrapProgress {
  /** Language whose runtime is booting (`python` / `ruby`). */
  language: string;
  loadedBytes: number;
  /** Null when the server sent no Content-Length — indeterminate. */
  totalBytes: number | null;
}

interface BootstrapProgressState {
  progress: BootstrapProgress | null;
  report: (progress: BootstrapProgress) => void;
  clear: () => void;
}

export const useBootstrapProgressStore = create<BootstrapProgressState>(set => ({
  progress: null,
  report: progress => set({ progress }),
  clear: () => set({ progress: null }),
}));

/** `34 MB` with one decimal under 10 MB, whole numbers above. */
export function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

/**
 * Compose the live loading line. With a known total:
 * `<base> 34 MB / 60 MB`; without: `<base> 34 MB`.
 */
export function formatBootstrapProgress(
  baseMessage: string,
  progress: BootstrapProgress
): string {
  const loaded = formatMegabytes(progress.loadedBytes);
  if (progress.totalBytes === null) return `${baseMessage} ${loaded}`;
  return `${baseMessage} ${loaded} / ${formatMegabytes(progress.totalBytes)}`;
}
