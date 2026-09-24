/**
 * implementation note — shared capsule export flow.
 *
 * Three call sites need the same sanitize → JSON.stringify (pretty)
 * → clipboard write → telemetry → status notice pipeline:
 *
 *   - Settings → Account → Run Capsules (`RunCapsulesSection`)
 *   - Command palette `Export latest run as capsule`
 *   - Result-panel header icon button (`RunCapsuleExportButton`,
 *     shipped this change)
 *
 * Without this helper each surface would re-implement the flow,
 * meaning a future telemetry contract change (new sizeBucket, new
 * trigger value) would need 3 edits. The helper takes the capsule
 * and the trigger tag (closed enum), then returns a discriminated
 * result so the caller controls which i18n keys land in the success
 * / fallback notices.
 *
 * `pretty` defaults to `true` for human-readable clipboard payloads;
 * `internal` share-links can pass `pretty: false` later when the URL
 * fragment encoder needs the minified form.
 *
 * Returns a discriminated result so the caller can render a
 * surface-specific fallback (e.g. the Settings surface shows an
 * inline textarea; the palette + result-panel surfaces point the
 * user back to Settings).
 */

import {
  bucketCapsuleSize,
  sanitizeRunCapsule,
  utf8ByteLength,
  type CapsuleSizeBucket,
  type RunCapsuleV1,
} from '../../shared/runCapsule';
import { trackEvent } from './telemetry';
import { recordTrustEventBestEffort } from '../stores/trustEventStore';

export type CapsuleExportTrigger =
  | 'settings-export'
  | 'palette-export'
  | 'result-panel-export'
  // implementation — per-row export from the capsule browse overlay.
  | 'list-export'
  | 'settings-export-file';

export interface CapsuleExportOptions {
  /** `true` (default) pretty-prints with 2-space indentation. */
  pretty?: boolean;
}

export type CapsuleExportResult =
  | { ok: true; json: string }
  | { ok: false; reason: 'no-clipboard' | 'clipboard-rejected'; json: string };

/** Shared sanitise/serialise boundary for clipboard and file exports. */
export function prepareRunCapsuleExport(capsule: RunCapsuleV1, pretty = true) {
  const sanitised = sanitizeRunCapsule(capsule);
  const json = pretty
    ? JSON.stringify(sanitised, null, 2)
    : JSON.stringify(sanitised);
  return { sanitised, json, sizeBucket: bucketCapsuleSize(utf8ByteLength(json)) };
}

/** Keep the export event contract in one place across clipboard and file handoff. */
export function trackCapsuleExport(
  trigger: CapsuleExportTrigger,
  sizeBucket: CapsuleSizeBucket
): void {
  void trackEvent('capsule.exported', { trigger, sizeBucket });
}

/**
 * Sanitise + serialise + clipboard-write + fire telemetry. Does NOT
 * push status notices itself — the caller decides which i18n key
 * lands so the copy can match the surface's voice. Returns the
 * outcome so the caller can render a surface-specific fallback.
 *
 * Telemetry fires unconditionally (fire-and-forget) so adoption is
 * measurable even on the clipboard-rejected path.
 */
export async function exportCapsuleToClipboard(
  capsule: RunCapsuleV1,
  trigger: CapsuleExportTrigger,
  options: CapsuleExportOptions = {}
): Promise<CapsuleExportResult> {
  const { sanitised, json, sizeBucket } = prepareRunCapsuleExport(
    capsule, options.pretty ?? true
  );
  trackCapsuleExport(trigger, sizeBucket);

  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return { ok: false, reason: 'no-clipboard', json };
  }
  try {
    await navigator.clipboard.writeText(json);
    // implementation note — record the egress in the local trust log
    // ONLY after the clipboard write succeeds (a rejected write means
    // nothing left the app). Summary is METADATA ONLY — the capsule
    // language + size bucket, never the capsule body or any field value.
    recordTrustEventBestEffort({
      feature: 'capsule-export',
      action: 'exported',
      sensitivity: 'medium',
      summary: `${sanitised.tab.language} capsule exported (${sizeBucket})`,
    });
    return { ok: true, json };
  } catch {
    return { ok: false, reason: 'clipboard-rejected', json };
  }
}
