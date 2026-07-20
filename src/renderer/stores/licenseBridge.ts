/**
 * internal — desktop license IPC bridge accessor, extracted verbatim from
 * `licenseStore.ts`. Lives in its own leaf so both the facade (which calls
 * `readLicenseBridge()` to choose web vs desktop) and `licenseDesktopStore`
 * (which needs the `LicenseBridge` type) can import it without the facade and
 * the desktop store importing each other. Depends only on the `window.lingua`
 * global — never on any store module.
 */

type FlatLicenseResult<T extends object> =
  | ({ ok: true } & T)
  | { ok: false; reason: string; message?: string; issues?: string[] };

function flattenLicenseResult<T extends object>(
  result: Result<T> & { issues?: string[] }
): FlatLicenseResult<T> {
  if (!result.ok) return result;
  return { ok: true, ...result.data };
}

/**
 * Detect and adapt the desktop IPC bridge at module-load time. The raw bridge
 * uses the shared Result data envelope; this leaf is the single compatibility
 * point that flattens successful license payloads for the existing desktop
 * store. Tests (vitest, JSDOM) normally omit the bridge and exercise web mode.
 */
export function readLicenseBridge() {
  if (typeof window === 'undefined') return null;
  const bridge = window.lingua?.license;
  if (!bridge) return null;

  return {
    getState: () => bridge.getState(),
    applyToken: async (token: string) => flattenLicenseResult(await bridge.applyToken(token)),
    clear: async () => flattenLicenseResult(await bridge.clear()),
    revalidate: async () => flattenLicenseResult(await bridge.revalidate()),
    removeDevice: async (deviceIdToRemove: string) =>
      flattenLicenseResult(await bridge.removeDevice(deviceIdToRemove)),
  };
}

/** The non-null desktop license bridge — the shape `createDesktopStore` drives. */
export type LicenseBridge = NonNullable<ReturnType<typeof readLicenseBridge>>;
