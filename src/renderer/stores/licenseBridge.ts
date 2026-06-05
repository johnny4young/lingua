/**
 * RL-130 — desktop license IPC bridge accessor, extracted verbatim from
 * `licenseStore.ts`. Lives in its own leaf so both the facade (which calls
 * `readLicenseBridge()` to choose web vs desktop) and `licenseDesktopStore`
 * (which needs the `LicenseBridge` type) can import it without the facade and
 * the desktop store importing each other. Depends only on the `window.lingua`
 * global — never on any store module.
 */

/**
 * Detect the desktop IPC bridge at module-load time. Tests (vitest, JSDOM)
 * never set this, so they run the same web path as the production web build.
 * Slice 0 of RL-059 keeps the bridge optional — when absent we transparently
 * fall through to the local-verify + zustand-persist behavior that shipped
 * in the renderer-only iteration.
 */
export function readLicenseBridge() {
  if (typeof window === 'undefined') return null;
  return window.lingua?.license ?? null;
}

/** The non-null desktop license bridge — the shape `createDesktopStore` drives. */
export type LicenseBridge = NonNullable<ReturnType<typeof readLicenseBridge>>;
