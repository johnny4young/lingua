import {
  DENY_SUBSTRINGS,
  REDACTION_VERSION,
  keyLooksSensitive,
  redactFlatRecord,
  valueLooksSensitive,
} from '../../shared/redaction';

/**
 * implementation — adaptor that lets the Privacy + Trust dashboard
 * surface preview run the SAME redactor logic as the rest of the
 * codebase against an arbitrary user-pasted string. Pure: no
 * network, no IO, no telemetry side effects.
 *
 * Two shapes are recognised:
 *
 *   1. **JSON object** — when the input parses as a flat object,
 *      route through `redactFlatRecord` (the canonical pipeline that
 *      capsule export uses). Surviving values appear in the output
 *      as-is, dropped keys are replaced with `<redacted>`. The
 *      `dropped` array surfaces what the redactor flagged, so the UI
 *      can list reasons.
 *
 *   2. **Free-form text** — for everything else (raw token strings,
 *      multi-line code blocks, etc.) we line-scan and substitute any
 *      occurrence of a `DENY_SUBSTRING`-looking key/value pair
 *      (`key=value`, `key: value`, etc.) with `key=<redacted>`. The
 *      heuristic is intentionally conservative — false positives
 *      (a legit `code = 42` line) are acceptable; false negatives
 *      (a real `sk-…` token slipping through) are not.
 */
export interface RedactionPreviewResult {
  readonly redacted: string;
  readonly hadJsonShape: boolean;
  readonly droppedKeys: ReadonlyArray<{
    readonly key: string;
    readonly reason: 'key' | 'value';
  }>;
  readonly redactorVersion: string;
}

export function applyRedactionPreview(input: string): RedactionPreviewResult {
  if (input.length === 0) {
    return emptyResult();
  }
  const trimmed = input.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const outcome = redactFlatRecord(parsed as Record<string, unknown>);
        const merged: Record<string, unknown> = { ...outcome.surviving };
        for (const drop of outcome.dropped) {
          merged[drop.key] = '<redacted>';
        }
        return {
          redacted: JSON.stringify(merged, null, 2),
          hadJsonShape: true,
          droppedKeys: outcome.dropped,
          redactorVersion: REDACTION_VERSION,
        };
      }
    } catch {
      // Fall through to free-form scan below.
    }
  }
  return scanFreeForm(input);
}

function scanFreeForm(input: string): RedactionPreviewResult {
  const droppedKeys: Array<{ key: string; reason: 'key' | 'value' }> = [];
  // Match `key=value`, `key: value`, `key : "value"`. Capture the
  // whitespace + separator + value separately so we can preserve the
  // user's original spacing around the key when we substitute.
  const pairPattern =
    /(\b[\w-]{1,64}\b)(\s*)(=|:)\s*("[^"]*"|'[^']*'|[^,;\s][^,;\n]*)/gu;
  const redacted = input.replace(
    pairPattern,
    (
      match,
      rawKey: string,
      preSep: string,
      sep: string,
      _rawValue: string
    ) => {
      const lower = rawKey.toLowerCase();
      const matchesDeny = DENY_SUBSTRINGS.some((sub) => lower.includes(sub));
      if (!matchesDeny && !keyLooksSensitive(rawKey)) return match;
      droppedKeys.push({ key: rawKey, reason: 'key' });
      return `${rawKey}${preSep}${sep} <redacted>`;
    }
  );
  return {
    redacted,
    hadJsonShape: false,
    droppedKeys,
    redactorVersion: REDACTION_VERSION,
  };
}

function emptyResult(): RedactionPreviewResult {
  return {
    redacted: '',
    hadJsonShape: false,
    droppedKeys: [],
    redactorVersion: REDACTION_VERSION,
  };
}

// Re-export the canonical helpers so call-sites can verify that
// `applyRedactionPreview` truly delegates to the same primitives the
// capsule + share-link pipelines use.
export { keyLooksSensitive, valueLooksSensitive, DENY_SUBSTRINGS };
