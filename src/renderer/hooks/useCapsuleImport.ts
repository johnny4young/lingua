/**
 * RL-094 Slice 2 — capsule import orchestration hook.
 *
 * Owns the side-effect-free preview state that `<CapsuleImportOverlay>`
 * renders. The hook itself never calls `editorStore.addTab` until the
 * caller invokes `openInNewTab()` — that gives the overlay full
 * control over confirmation gating.
 *
 * Three load surfaces (matching the closed `CAPSULE_IMPORT_SOURCES`
 * telemetry enum):
 *
 *   - `paste` — `decodeFromText(json)` directly from the textarea AND
 *     the optional clipboard auto-detect on mount (fold C, gated on
 *     `capsuleImportClipboardOnFocusConsent === 'granted'`).
 *   - `file-picker` — `decodeFromFile(file)` after the hidden
 *     `<input type="file">` resolves; web + desktop both go through
 *     the same `File.text()` so there's no IPC dependency.
 *   - `drag-drop` — `decodeFromFile(file)` from the overlay's drop
 *     zone (fold B). Multi-file drag picks ONLY the first file.
 *
 * All three converge on `tryDecodeCapsuleJson` (from
 * `src/renderer/utils/importCapsule.ts`) which delegates to the
 * shared `parseRunCapsule` validator. Reject reasons are mapped to a
 * smaller renderer-facing enum that drives the overlay's i18n keys
 * directly + telemetry status bucket.
 *
 * Telemetry (fold D):
 *   - `decode` → `capsule.imported { surface, status, sizeBucket }`
 *     with `status ∈ {'decoded', 'rejected'}`.
 *   - `openInNewTab` → `status: 'open-confirmed'`.
 *   - `reset` after a `decoded` state → `status: 'cancelled'`.
 *
 * Wire-name note: the telemetry property is `surface` (not
 * `sourceSurface`) because `source` is in DENY_SUBSTRINGS and the
 * redactor would strip the value before it reached the closed-enum
 * validator. Internal field is still `sourceSurface` for clarity at
 * the call sites.
 *
 * The hook does NOT fire telemetry on overlay close from the parent
 * — the parent calls `reset()` in its unmount cleanup if needed, or
 * directly fires `cancelled` when it wants to attribute a discard.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  tryDecodeCapsuleJson,
  type CapsuleImportDecodeResult,
  type CapsuleImportRejectReason,
} from '../utils/importCapsule';
import { trackEvent } from '../utils/telemetry';
import type { RunCapsuleV1, CapsuleSizeBucket } from '../../shared/runCapsule';
import { useSettingsStore } from '../stores/settingsStore';
import { openCapsuleSourceInNewTab } from '../utils/openCapsuleTab';

export type CapsuleImportSourceSurface = 'paste' | 'file-picker' | 'drag-drop';

export interface CapsuleImportDecodedState {
  kind: 'decoded';
  capsule: RunCapsuleV1;
  sizeBucket: CapsuleSizeBucket;
  byteLength: number;
  sourceSurface: CapsuleImportSourceSurface;
  /** Raw JSON the user fed in. Held so the overlay can copy it back to clipboard (fold E). */
  rawJson: string;
}

export interface CapsuleImportRejectedState {
  kind: 'rejected';
  reason: CapsuleImportRejectReason;
  sizeBucket: CapsuleImportDecodedState['sizeBucket'];
  byteLength: number;
  sourceSurface: CapsuleImportSourceSurface;
  detail?: string;
}

export type CapsuleImportState =
  | { kind: 'empty' }
  | CapsuleImportDecodedState
  | CapsuleImportRejectedState;

export interface UseCapsuleImportOptions {
  /**
   * When omitted, the hook uses the global `editorStore.addTab` flow.
   * Tests override this so they can assert the tab payload without
   * mounting the real store.
   */
  onOpenAsNewTab?: (capsule: RunCapsuleV1) => void;
  /**
   * When omitted, the hook reads from `useSettingsStore` directly.
   * Tests can inject a stable consent value.
   */
  clipboardConsent?: 'unset' | 'granted' | 'declined';
  /**
   * Internal test seam — defaults to `navigator.clipboard.readText`.
   */
  readClipboard?: () => Promise<string>;
}

export interface UseCapsuleImportApi {
  state: CapsuleImportState;
  /** Decode raw JSON text from the paste surface OR the clipboard auto-detect. */
  decodeFromText: (
    rawJson: string,
    surface?: CapsuleImportSourceSurface
  ) => CapsuleImportDecodeResult;
  /** Decode the contents of a File object (file picker or drag-drop). */
  decodeFromFile: (
    file: File,
    surface: 'file-picker' | 'drag-drop'
  ) => Promise<CapsuleImportDecodeResult>;
  /** Confirm + push tab. No-op when state isn't `'decoded'`. */
  openInNewTab: () => void;
  /** Clear state. Fires `'cancelled'` telemetry when the prior state was `'decoded'`. */
  reset: () => void;
  /**
   * Best-effort clipboard auto-detect. Returns the decoded result
   * when consent is granted AND clipboard yields a valid capsule;
   * otherwise null. Caller decides whether to surface a prompt for
   * unset consent.
   */
  attemptClipboardAutofill: () => Promise<CapsuleImportDecodeResult | null>;
}

const MAX_FILE_SIZE = 4 * 1024 * 1024 * 2; // 8 MiB read cap; parser still rejects > 4 MiB.

export function useCapsuleImport(
  options: UseCapsuleImportOptions = {}
): UseCapsuleImportApi {
  const [state, setState] = useState<CapsuleImportState>({ kind: 'empty' });
  // The latest decoded raw JSON is held in a ref so `openInNewTab`
  // doesn't need to depend on `state` (which would re-create the
  // callback per render).
  const decodedRef = useRef<CapsuleImportDecodedState | null>(null);

  const onOpenAsNewTab = options.onOpenAsNewTab;
  const readClipboard = options.readClipboard;

  const fireTelemetry = useCallback(
    (
      surface: CapsuleImportSourceSurface,
      status: 'decoded' | 'rejected' | 'open-confirmed' | 'cancelled',
      sizeBucket: CapsuleImportDecodedState['sizeBucket']
    ) => {
      // Property is named `surface` (not `sourceSurface`) on the wire
      // because `source` is in DENY_SUBSTRINGS — see RL-094 Slice 2
      // fold D telemetry comment in `src/shared/telemetry.ts`.
      void trackEvent('capsule.imported', {
        surface,
        status,
        sizeBucket,
      });
    },
    []
  );

  const decodeFromText = useCallback(
    (
      rawJson: string,
      surface: CapsuleImportSourceSurface = 'paste'
    ): CapsuleImportDecodeResult => {
      const decode = tryDecodeCapsuleJson(rawJson);
      if (decode.ok) {
        const next: CapsuleImportDecodedState = {
          kind: 'decoded',
          capsule: decode.capsule,
          sizeBucket: decode.sizeBucket,
          byteLength: decode.byteLength,
          sourceSurface: surface,
          rawJson: rawJson.trim(),
        };
        decodedRef.current = next;
        setState(next);
        fireTelemetry(surface, 'decoded', decode.sizeBucket);
      } else {
        decodedRef.current = null;
        setState({
          kind: 'rejected',
          reason: decode.reason,
          sizeBucket: decode.sizeBucket,
          byteLength: decode.byteLength,
          sourceSurface: surface,
          ...(decode.detail ? { detail: decode.detail } : {}),
        });
        fireTelemetry(surface, 'rejected', decode.sizeBucket);
      }
      return decode;
    },
    [fireTelemetry]
  );

  const decodeFromFile = useCallback(
    async (
      file: File,
      surface: 'file-picker' | 'drag-drop'
    ): Promise<CapsuleImportDecodeResult> => {
      if (file.size > MAX_FILE_SIZE) {
        // Files comfortably bigger than the cap are rejected without
        // even calling `.text()` so a 100 MiB drop doesn't lock the
        // tab while the FileReader streams it.
        const sizeBucket: CapsuleSizeBucket = '>=4mb';
        decodedRef.current = null;
        setState({
          kind: 'rejected',
          reason: 'oversized',
          sizeBucket,
          byteLength: file.size,
          sourceSurface: surface,
        });
        fireTelemetry(surface, 'rejected', sizeBucket);
        return {
          ok: false,
          reason: 'oversized',
          sizeBucket,
          byteLength: file.size,
        };
      }
      let text: string;
      try {
        text = await file.text();
      } catch {
        // Browser failure to read — treat as malformed-json so the
        // user sees a sensible error rather than a silent no-op.
        const sizeBucket: CapsuleSizeBucket = '<10kb';
        decodedRef.current = null;
        setState({
          kind: 'rejected',
          reason: 'malformed-json',
          sizeBucket,
          byteLength: 0,
          sourceSurface: surface,
          detail: 'file-read-failed',
        });
        fireTelemetry(surface, 'rejected', sizeBucket);
        return {
          ok: false,
          reason: 'malformed-json',
          sizeBucket,
          byteLength: 0,
          detail: 'file-read-failed',
        };
      }
      return decodeFromText(text, surface);
    },
    [decodeFromText, fireTelemetry]
  );

  const openInNewTab = useCallback(() => {
    const decoded = decodedRef.current;
    if (!decoded) return;
    // Reviewer fix (RL-094 Slice 2 final pass) — clear the decoded
    // ref BEFORE side effects so a fast double-click on the confirm
    // button (the overlay closes async via React commit, the second
    // click can fire before unmount) cannot create two identical
    // tabs.
    decodedRef.current = null;
    fireTelemetry(decoded.sourceSurface, 'open-confirmed', decoded.sizeBucket);
    if (onOpenAsNewTab) {
      onOpenAsNewTab(decoded.capsule);
    } else {
      // Default flow — push the capsule's source.content as a new
      // editor tab. Drops the result/stdin/environment on purpose:
      // Slice 2 promises "open the SOURCE in a new tab", NOT auto-
      // replay. The user has to click Run to re-execute.
      pushCapsuleAsTab(decoded.capsule);
    }
  }, [fireTelemetry, onOpenAsNewTab]);

  const reset = useCallback(() => {
    const decoded = decodedRef.current;
    if (decoded) {
      fireTelemetry(decoded.sourceSurface, 'cancelled', decoded.sizeBucket);
    }
    decodedRef.current = null;
    setState({ kind: 'empty' });
  }, [fireTelemetry]);

  const attemptClipboardAutofill = useCallback(async (): Promise<CapsuleImportDecodeResult | null> => {
    // Resolve consent at call time so a Settings flip during the
    // overlay's lifetime is respected.
    const consent =
      options.clipboardConsent ??
      useSettingsStore.getState().capsuleImportClipboardOnFocusConsent;
    if (consent !== 'granted') return null;
    const reader = readClipboard ?? defaultReadClipboard;
    let text: string;
    try {
      text = await reader();
    } catch {
      return null;
    }
    if (!text || text.trim().length === 0) return null;
    // Cheap shape probe before paying the cost of the schema validator —
    // a clipboard with random text shouldn't surface a noisy "rejected"
    // banner. Only attempt decode if the payload at least starts with `{`.
    if (!text.trim().startsWith('{')) return null;
    const result = decodeFromText(text, 'paste');
    return result;
  }, [decodeFromText, options.clipboardConsent, readClipboard]);

  // Reset the ref if the component using the hook unmounts mid-state.
  useEffect(() => {
    return () => {
      decodedRef.current = null;
    };
  }, []);

  return {
    state,
    decodeFromText,
    decodeFromFile,
    openInNewTab,
    reset,
    attemptClipboardAutofill,
  };
}

async function defaultReadClipboard(): Promise<string> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
    throw new Error('clipboard-unavailable');
  }
  return navigator.clipboard.readText();
}

/**
 * Default openInNewTab handler — creates a new editor tab whose
 * content matches `capsule.source.content`. Delegates to the shared
 * `openCapsuleSourceInNewTab` helper so the import flow and the
 * capsule browse overlay (RL-094 Slice 3) stay identical in how they
 * materialise a capsule's source.
 *
 * RL-094 Slice 2 fold G — when the capsule's `tab.language === 'http'`
 * the consumer (overlay) should offer "Open in HTTP workspace" as a
 * secondary affordance. Here we ALWAYS fall back to a plain text/json
 * tab — the HTTP-specific bridge is rendered by the overlay and is
 * NOT auto-applied to avoid silent workspace mutations.
 */
function pushCapsuleAsTab(capsule: RunCapsuleV1): void {
  openCapsuleSourceInNewTab(capsule);
}
