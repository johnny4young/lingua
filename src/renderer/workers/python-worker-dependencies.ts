import type {
  DependencyInstallFailureReason,
  DependencyInstallOutcome,
} from '../../shared/dependencies/types';
import type { PythonWorkerDependencyMessage, PythonWorkerPort } from './python-worker-protocol';
import { classifyMicropipError, type PythonRuntimeAdapter } from './python-worker-runtime';
import type { PyProxyLike } from './python-worker-serialization';

// implementation — defensive PyPI-name regex. PyPI's accepted form is
// case-insensitive: starts with a letter or digit, allows interior
// `[A-Za-z0-9._-]`, and ends in a letter or digit. Trailing `.` or
// `-` would resolve to surprising packages once PyPI's normaliser
// stripped them; we reject them up front instead. Total length cap
// matches PyPI's documented 214-char ceiling.
const PYTHON_PACKAGE_NAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,212}[a-zA-Z0-9])?$/u;

export function createPythonDependencyHandler(
  ctx: PythonWorkerPort,
  runtime: PythonRuntimeAdapter
) {
  return async (msg: PythonWorkerDependencyMessage): Promise<void> => {
    if (msg.type === 'dependencies:list-loaded') {
      const { requestId } = msg;
      try {
        const py = await runtime.loadPyodide();
        const loaded = py.loadedPackages ? Object.keys(py.loadedPackages) : [];
        ctx.postMessage({
          type: 'dependencies:list-loaded:reply',
          requestId,
          packages: loaded,
        });
      } catch {
        // Pyodide boot failed — caller falls back to `'detected'` for
        // every name, preserving implementation's honest signal.
        ctx.postMessage({
          type: 'dependencies:list-loaded:reply',
          requestId,
          packages: [],
        });
      }
      return;
    }

    if (msg.type === 'dependencies:install') {
      const { runId, specifiers } = msg;
      // Defensive validation: even though the renderer-side implementation
      // detector returns clean PyPI names, the worker re-validates so
      // a compromised renderer cannot smuggle injection text into
      // `micropip.install`. Reviewer fix — track REJECTED names too so
      // the final statuses map covers every input. Otherwise the
      // renderer would leave those rows stuck in `'installing'`
      // because `endInstall` only flips names it sees in
      // `perNameStatus`.
      const seen = new Set<string>();
      const safeNames: string[] = [];
      const rejectedNames: string[] = [];
      for (const raw of specifiers) {
        if (typeof raw !== 'string') continue;
        if (!PYTHON_PACKAGE_NAME_RE.test(raw)) {
          rejectedNames.push(raw);
          continue;
        }
        if (seen.has(raw)) continue;
        seen.add(raw);
        safeNames.push(raw);
      }
      if (safeNames.length === 0) {
        const statuses: Record<string, 'installed' | 'failed' | 'cancelled' | 'skipped-preflight'> =
          {};
        for (const name of rejectedNames) statuses[name] = 'failed';
        ctx.postMessage({
          type: 'dependencies:install:done',
          runId,
          statuses,
          outcome: 'failed' as DependencyInstallOutcome,
          failureReason: 'invalid-specifier' as DependencyInstallFailureReason,
        });
        return;
      }

      try {
        ctx.postMessage({
          type: 'dependencies:install:log',
          runId,
          stream: 'stdout',
          chunk: 'Loading Python runtime...\n',
        });
        const micropip = await runtime.ensureMicropip();
        ctx.postMessage({
          type: 'dependencies:install:log',
          runId,
          stream: 'stdout',
          chunk: `Installing ${safeNames.join(', ')} via micropip...\n`,
        });
        // Reviewer fix — pass a Python list (not the raw JS array) to
        // `micropip.install`. Recent Pyodide versions still accept JS
        // arrays via PyProxy auto-conversion, but the conversion has
        // historically been fragile across releases (a passed-through
        // JS array can coerce to `str([...])`). Using `pyodide.toPy`
        // is the documented defensive path. Reviewer fix v2 — wrap in
        // try/finally so the PyProxy returned by `toPy` is destroyed
        // even if `micropip.install` throws (avoids one PyProxy leak
        // per install).
        const py = await runtime.loadPyodide();
        const argument = typeof py.toPy === 'function' ? py.toPy(safeNames) : safeNames;
        try {
          await Promise.resolve(micropip.install!(argument));
        } finally {
          if (
            argument &&
            argument !== safeNames &&
            typeof (argument as PyProxyLike).destroy === 'function'
          ) {
            try {
              (argument as PyProxyLike).destroy!();
            } catch {
              // Best-effort destroy; the PyProxy may already be gone if
              // Pyodide recycled it internally.
            }
          }
        }
        const statuses: Record<string, 'installed' | 'failed' | 'cancelled' | 'skipped-preflight'> =
          {};
        for (const name of safeNames) statuses[name] = 'installed';
        for (const name of rejectedNames) statuses[name] = 'failed';
        // implementation reviewer fix — when SOME names were rejected
        // (regex-invalid) but the rest installed cleanly, surface a
        // `partial` outcome so the renderer can see "some succeeded,
        // some failed". The dominant failure reason is the regex
        // rejection.
        const outcome: DependencyInstallOutcome = rejectedNames.length > 0 ? 'partial' : 'success';
        const failureReason: DependencyInstallFailureReason | null =
          rejectedNames.length > 0 ? 'invalid-specifier' : null;
        ctx.postMessage({
          type: 'dependencies:install:done',
          runId,
          statuses,
          outcome,
          failureReason,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const reason: DependencyInstallFailureReason = classifyMicropipError(message);
        ctx.postMessage({
          type: 'dependencies:install:log',
          runId,
          stream: 'stderr',
          chunk: `${message}\n`,
        });
        const statuses: Record<string, 'installed' | 'failed' | 'cancelled' | 'skipped-preflight'> =
          {};
        for (const name of safeNames) statuses[name] = 'failed';
        for (const name of rejectedNames) statuses[name] = 'failed';
        ctx.postMessage({
          type: 'dependencies:install:done',
          runId,
          statuses,
          outcome: 'failed' as DependencyInstallOutcome,
          failureReason: reason,
        });
      }
      return;
    }
  };
}
