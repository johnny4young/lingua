/**
 * RL-036 Phase A1 — Renderer-side share-link helper.
 *
 * Three call sites need the same FileTab → SharePayloadV1 → encoded
 * fragment → clipboard + telemetry pipeline:
 *
 *   - Result-panel header icon button (`<ShareLinkButton>`, Fold E)
 *   - Command palette `Copy share link` action (Fold C)
 *   - `Mod+Shift+P` keyboard shortcut (Fold D)
 *
 * The helper splits the work into two pure async stages so the
 * caller can interpose a confirmation modal (Fold A) between encode
 * and clipboard write without duplicating the encode logic:
 *
 *   1. `prepareShareLinkFromTab(tab)` — encodes and composes the URL.
 *      Returns a discriminated result with the prepared link or a
 *      reject reason (`source-too-large`, `fragment-too-large`,
 *      `unknown-language`).
 *   2. `writeShareLinkToClipboard(url)` — clipboard write only.
 *      Returns a discriminated result with `no-clipboard` or
 *      `clipboard-rejected` failure shapes.
 *
 * Telemetry (Fold B + G) fires fire-and-forget through
 * `trackShareCreated` — closed-enum `{ trigger, status, sizeBucket }`
 * mirrored on update-server with parity test.
 */

import {
  SHARE_FRAGMENT_PREFIX,
  bucketShareSize,
  buildSharePayload,
  encodeShareFragment,
  type SharePayloadV1,
  type ShareSizeBucket,
} from '../../shared/sharePayload';
import type { FileTab } from '../types';
import { trackEvent } from './telemetry';

/**
 * Surface that initiated the share. Used by `share.created` telemetry
 * so dashboards can distinguish the relative adoption of the icon
 * button vs the palette vs the keyboard shortcut.
 */
export type ShareCreateTrigger = 'button' | 'palette' | 'shortcut';

/**
 * Closed enum mirrored on update-server. `cancelled` currently covers
 * user dismissal and clipboard-write failure — useful adoption metric:
 * how often users do not end up with a usable link.
 */
export type ShareCreateStatus =
  | 'success'
  | 'too-large'
  | 'unknown-language'
  | 'cancelled';

/**
 * Closed enum mirrored on update-server. Symmetric counterpart to
 * `ShareCreateStatus` for the decode (URL-fragment import) path.
 */
export type ShareOpenStatus =
  | 'success'
  | 'decode-fail'
  | 'unknown-language'
  | 'unknown-version'
  | 'oversized';

export interface PreparedShareLink {
  readonly url: string;
  readonly fragment: string;
  readonly payload: SharePayloadV1;
  readonly sizeBytes: number;
}

export type PrepareShareLinkResult =
  | { ok: true; link: PreparedShareLink }
  | {
      ok: false;
      reason: 'source-too-large' | 'fragment-too-large' | 'unknown-language';
      sizeBytes: number;
    };

export type WriteShareLinkResult =
  | { ok: true }
  | { ok: false; reason: 'no-clipboard' | 'clipboard-rejected' };

/**
 * Hardcoded marketing host for cross-install shares. A Lingua user on
 * desktop sharing a snippet always emits a URL pointing at the public
 * web app so the recipient can open it without installing anything.
 * Web users emit a URL relative to their own origin so the recipient
 * stays on the same deployment they were already using.
 */
const MARKETING_APP_URL = 'https://app.linguacode.dev';

/**
 * Compose the absolute base URL the encoded fragment hangs off. Web
 * uses `${origin}${pathname}` minus trailing slash; desktop /
 * non-http origins fall back to the marketing app.
 */
function getShareBaseUrl(): string {
  if (typeof window === 'undefined') return MARKETING_APP_URL;
  const protocol = window.location.protocol;
  if (protocol === 'http:' || protocol === 'https:') {
    const base = `${window.location.origin}${window.location.pathname}`;
    return base.endsWith('/') && base !== `${window.location.origin}/`
      ? base.replace(/\/$/, '')
      : base;
  }
  return MARKETING_APP_URL;
}

/**
 * Stage 1: encode + compose. Pure async, no side effects beyond the
 * gzip stream. The caller is responsible for whatever UX gating
 * happens between encode and clipboard write (e.g. confirmation
 * modal in Fold A).
 */
export async function prepareShareLinkFromTab(
  tab: Pick<
    FileTab,
    | 'name'
    | 'language'
    | 'content'
    | 'runtimeMode'
    | 'workflowMode'
    | 'autoLogEnabled'
    | 'stdinBuffer'
  >
): Promise<PrepareShareLinkResult> {
  const payload = buildSharePayload({
    name: tab.name,
    language: tab.language,
    content: tab.content,
    runtimeMode: tab.runtimeMode,
    workflowMode: tab.workflowMode,
    autoLogEnabled: tab.autoLogEnabled,
    stdinBuffer: tab.stdinBuffer,
  });
  const encoded = await encodeShareFragment(payload);
  if (!encoded.ok) {
    return { ok: false, reason: encoded.reason, sizeBytes: encoded.sizeBytes };
  }
  const base = getShareBaseUrl();
  return {
    ok: true,
    link: {
      url: `${base}#${encoded.fragment}`,
      fragment: encoded.fragment,
      payload,
      sizeBytes: encoded.sizeBytes,
    },
  };
}

/**
 * Stage 2: clipboard-only. Defers all telemetry to the caller so a
 * `cancelled` status (user dismissed Fold A modal) doesn't get
 * miscounted as a successful clipboard write.
 */
export async function writeShareLinkToClipboard(
  url: string
): Promise<WriteShareLinkResult> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return { ok: false, reason: 'no-clipboard' };
  }
  try {
    await navigator.clipboard.writeText(url);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'clipboard-rejected' };
  }
}

/**
 * Fire-and-forget telemetry for the create (encode) side of the
 * share-link lifecycle. Closed enums mirrored on update-server.
 */
export function trackShareCreated(args: {
  readonly trigger: ShareCreateTrigger;
  readonly status: ShareCreateStatus;
  readonly sizeBucket: ShareSizeBucket;
}): void {
  void trackEvent('share.created', args);
}

/**
 * Fire-and-forget telemetry for the open (decode / import) side of
 * the share-link lifecycle. Closed enums mirrored on update-server.
 */
export function trackShareOpened(args: {
  readonly status: ShareOpenStatus;
  readonly sizeBucket: ShareSizeBucket;
}): void {
  void trackEvent('share.opened', args);
}

/**
 * Reject-reason → telemetry status mapping for the create side.
 * Lives here so every caller uses the same translation.
 */
export function shareCreateStatusFromPrepareReason(
  reason: Exclude<PrepareShareLinkResult, { ok: true }>['reason']
): Extract<ShareCreateStatus, 'too-large' | 'unknown-language'> {
  switch (reason) {
    case 'source-too-large':
    case 'fragment-too-large':
      return 'too-large';
    case 'unknown-language':
      return 'unknown-language';
  }
}

/**
 * Convenience export so the boot hook + import path can bucket the
 * raw fragment length they observed (before decode) without
 * importing the shared module directly.
 */
export { bucketShareSize, SHARE_FRAGMENT_PREFIX };
