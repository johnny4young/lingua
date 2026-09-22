import { resolveSystemLanguage } from '../shared/i18n/languages';

type StartupStage = 'initialization' | 'renderer-load';
const DIAGNOSTIC_CODES = [
  'ENOENT',
  'EACCES',
  'EPERM',
  'ENOSPC',
  'EIO',
  'ETIMEDOUT',
  'ERR_CONNECTION_REFUSED',
  'ERR_FILE_NOT_FOUND',
  'ERR_FAILED',
  'ERR_ABORTED',
] as const;
type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number] | 'UNKNOWN';
export interface StartupFailure {
  stage: StartupStage;
  code: DiagnosticCode;
}

function diagnosticCode(error: unknown): DiagnosticCode {
  try {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = error.code;
      if (DIAGNOSTIC_CODES.some(allowed => allowed === code)) return code as DiagnosticCode;
    }
  } catch {
    /* Do not invoke an untrusted error formatter or expose its payload. */
  }
  return 'UNKNOWN';
}

export function startupFailureMessage(failure: StartupFailure, languages: readonly string[]) {
  const diagnostic = `${failure.stage}/${failure.code}`;
  return resolveSystemLanguage(languages) === 'es'
    ? {
        title: 'Lingua no pudo iniciar',
        content: `Lingua se cerrará porque el inicio no terminó correctamente.\nComprueba que la instalación esté completa y vuelve a abrir la aplicación.\n\nDiagnóstico: ${diagnostic}`,
      }
    : {
        title: 'Lingua could not start',
        content: `Lingua will close because startup did not finish safely.\nCheck that the installation is complete and open the app again.\n\nDiagnostic: ${diagnostic}`,
      };
}

/** One terminal owner for startup and later window creation; never resume after failure. */
export function createStartupGuard(report: (failure: StartupFailure) => void, exit: () => void) {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    stop: () => controller.abort(),
    async run(stage: StartupStage, operation: (signal: AbortSignal) => void | Promise<void>) {
      if (controller.signal.aborted) return;
      try {
        await operation(controller.signal);
      } catch (error) {
        if (controller.signal.aborted) return;
        controller.abort();
        try {
          report({ stage, code: diagnosticCode(error) });
        } catch {
          /* Even failure to display the native dialog must terminate. */
        } finally {
          exit();
        }
      }
    },
  };
}

// Preserve the dev server's existing thirty-second startup grace period, but
// bound a pending load too (not just the pauses between refused connections).
export const RENDERER_STARTUP_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 1000;

function waitForRetry(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, RETRY_DELAY_MS);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
}

/** Every promise is observed; quit, window closure and deadline cancel retries. */
export async function loadStartupRenderer(
  load: () => Promise<unknown>,
  signal: AbortSignal,
  retry: boolean
): Promise<void> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal.addEventListener('abort', cancel, { once: true });
  const deadline = setTimeout(
    () =>
      controller.abort(
        Object.assign(new Error('Renderer startup timed out'), { code: 'ETIMEDOUT' })
      ),
    RENDERER_STARTUP_TIMEOUT_MS
  );
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
      once: true,
    });
  });
  const attempts = async () => {
    for (let attempt = 0; ; attempt++) {
      controller.signal.throwIfAborted();
      try {
        await load();
        controller.signal.throwIfAborted();
        return;
      } catch (error) {
        controller.signal.throwIfAborted();
        if (!retry || attempt === 30) throw error;
        await waitForRetry(controller.signal);
      }
    }
  };
  try {
    await Promise.race([attempts(), aborted]);
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener('abort', cancel);
    controller.abort();
  }
}
