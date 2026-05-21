/**
 * RL-094 Slice 1.5 fold B — shared capsule export flow.
 *
 * Three call sites need the same sanitize → JSON.stringify (pretty)
 * → clipboard write → telemetry → status notice pipeline:
 *
 *   - Settings → Account → Run Capsules (`RunCapsulesSection`)
 *   - Command palette `Export latest run as capsule`
 *   - Result-panel header icon button (`RunCapsuleExportButton`,
 *     shipped this slice)
 *
 * Without this helper each surface would re-implement the flow,
 * meaning a future telemetry contract change (new sizeBucket, new
 * trigger value) would need 3 edits. The helper takes the capsule
 * and the trigger tag (closed enum), then returns a discriminated
 * result so the caller controls which i18n keys land in the success
 * / fallback notices.
 *
 * `pretty` defaults to `true` for human-readable clipboard payloads;
 * `RL-036` share-links can pass `pretty: false` later when the URL
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
  type RunCapsuleV1,
} from '../../shared/runCapsule';
import { trackEvent } from './telemetry';

export type CapsuleExportTrigger =
  | 'settings-export'
  | 'palette-export'
  | 'result-panel-export';

export interface CapsuleExportOptions {
  /** `true` (default) pretty-prints with 2-space indentation. */
  pretty?: boolean;
}

export type CapsuleExportResult =
  | { ok: true; json: string }
  | { ok: false; reason: 'no-clipboard' | 'clipboard-rejected'; json: string };

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
  const sanitised = sanitizeRunCapsule(capsule);
  const pretty = options.pretty ?? true;
  const json = pretty
    ? JSON.stringify(sanitised, null, 2)
    : JSON.stringify(sanitised);
  const sizeBucket = bucketCapsuleSize(utf8ByteLength(json));
  void trackEvent('capsule.exported', { trigger, sizeBucket });

  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return { ok: false, reason: 'no-clipboard', json };
  }
  try {
    await navigator.clipboard.writeText(json);
    return { ok: true, json };
  } catch {
    return { ok: false, reason: 'clipboard-rejected', json };
  }
}
