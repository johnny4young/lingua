/**
 * Chooses how the trial, education and recovery requests leave the renderer:
 * through main on desktop (`window.lingua.license`), with `fetch` and
 * `VITE_LINGUA_LICENSE_SERVER_URL` on the web.
 */

type LicenseBridge = NonNullable<LinguaAPI['license']>;

export function readLicenseFlowBridge(): LicenseBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.lingua?.license;
}

export function readLicenseServerBaseUrl(): string | null {
  const raw = import.meta.env.VITE_LINGUA_LICENSE_SERVER_URL;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\/$/, '');
  return trimmed.length === 0 ? null : trimmed;
}

/** Keeps the services' never-throw contract when the IPC call itself rejects. */
export async function viaBridge<R>(
  call: () => Promise<R>
): Promise<R | { ok: false; reason: 'unreachable'; message: string }> {
  try {
    return await call();
  } catch (error) {
    return {
      ok: false,
      reason: 'unreachable',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
