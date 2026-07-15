import { describe, expect, it } from 'vitest';
import type { TelemetryTrack } from '../../src/renderer/hooks/useTelemetry';

// This helper is never called. `typecheck:tests` compiles its body so the
// expected type error below turns the closed event catalog into a real gate.
export function assertTelemetryTrackTypes(track: TelemetryTrack): void {
  track('app.launched', { platform: 'darwin' });
  // @ts-expect-error -- telemetry event names must come from TELEMETRY_EVENTS.
  track('app.not-in-the-closed-catalog');
}

describe('TelemetryTrack compile guard', () => {
  it('is enforced by typecheck:tests', () => {
    expect(true).toBe(true);
  });
});
