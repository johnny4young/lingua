/**
 * Dependency-neutral bridge between telemetry policy and the settings store.
 *
 * Telemetry is called by settings actions, while the consent value is owned by
 * the assembled settings store. Importing that store from telemetry would
 * create an eager initialization cycle. The store registers its live reader
 * after construction instead; until then the privacy-safe answer is no
 * consent.
 */

export type TelemetryConsent = 'granted' | 'declined' | 'unset' | null;

let readConsent: (() => TelemetryConsent) | null = null;

export function registerTelemetryConsentReader(reader: () => TelemetryConsent): void {
  readConsent = reader;
}

export function currentTelemetryConsent(): TelemetryConsent {
  return readConsent?.() ?? null;
}
