import { useCallback, useMemo } from 'react';
import type { TelemetryEventName } from '../../shared/telemetry';
import { trackEvent } from '../utils/telemetry';

export type TelemetryProperties = Record<string, string | number | boolean>;

export type TelemetryTrack = (
  eventName: TelemetryEventName,
  properties?: TelemetryProperties
) => void;

export interface TelemetryTracker {
  readonly track: TelemetryTrack;
}

/**
 * React entry point for renderer telemetry.
 *
 * Event names are checked against the shared closed catalog at the call site,
 * while the lower-level emitter continues to own consent, endpoint selection,
 * base fields, redaction, and best-effort delivery.
 */
export function useTelemetry(): TelemetryTracker {
  const track = useCallback<TelemetryTrack>((eventName, properties = {}) => {
    void trackEvent(eventName, properties);
  }, []);

  return useMemo(() => ({ track }), [track]);
}
