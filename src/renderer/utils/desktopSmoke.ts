import { getActiveEditor } from '../runtime/editorAccess';

export function desktopSmokeEnabled(): boolean {
  return Boolean(window.lingua?.desktopSmoke);
}

export function desktopSmokeApi() {
  return window.lingua?.desktopSmoke ?? null;
}

interface DesktopSmokeEditorWaitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  expectedContent?: string;
}

/**
 * Wait for the real Monaco instance rather than sleeping for an arbitrary
 * render delay. The desktop performance artifact calls the result "first
 * editor interaction", so the readiness condition must prove the editor and
 * its model are mounted before stopping that timer.
 */
export async function waitForDesktopSmokeEditorReady({
  timeoutMs = 10_000,
  pollIntervalMs = 16,
  expectedContent,
}: DesktopSmokeEditorWaitOptions = {}): Promise<void> {
  const startedAt = performance.now();

  while (performance.now() - startedAt < timeoutMs) {
    const editor = getActiveEditor();
    const model = editor?.getModel();
    const contentMatches =
      expectedContent === undefined ||
      model?.getValue().replace(/\r\n?/g, '\n') === expectedContent.replace(/\r\n?/g, '\n');
    if (model && contentMatches) {
      return;
    }
    await new Promise<void>(resolve => {
      window.setTimeout(resolve, pollIntervalMs);
    });
  }

  throw new Error(`Desktop smoke editor did not become interactive within ${timeoutMs}ms.`);
}
