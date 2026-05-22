import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SHARE_FRAGMENT_PREFIX,
  bucketShareSize,
  decodeShareFragment,
  type ShareDecodeResult,
} from '../../shared/sharePayload';
import { createDefaultTab, useEditorStore } from '../stores/editorStore';
import { useUIStore } from '../stores/uiStore';
import {
  trackShareOpened,
  type ShareOpenStatus,
} from '../utils/shareLink';
import { isSafeMode } from '../utils/safeBoot';
import type { Language } from '../types';

/**
 * RL-036 Phase A1 — Hash-fragment share-link importer.
 *
 * Mounted once AppChrome marks session restore ready (so
 * user-restored tabs land first; the imported tab is the active
 * selection). The hook decodes `window.location.hash` if it carries the
 * `#share=v1.<...>` prefix and, on success, opens a new tab via
 * `editorStore.addTab()`. Failures push a localized status notice
 * and clear the hash so a subsequent reload doesn't keep failing.
 *
 * Safe-mode boot (`?safe-mode=1`) skips the importer entirely — the
 * recovery surface should never run user-supplied content during a
 * crash recovery cycle.
 *
 * Telemetry (`share.opened { status, sizeBucket }`) fires on every
 * outcome, including the silent no-op when the hash carries no
 * share fragment at all (filtered out without a telemetry event so
 * the dashboard isn't drowned by app-boot noise).
 */
export interface UseShareLinkBootOptions {
  readonly enabled?: boolean;
}

export function useShareLinkBoot({
  enabled = true,
}: UseShareLinkBootOptions = {}): void {
  // The hook subscribes to the i18n locale via `useTranslation` so a
  // locale flip remounts the effect — fresh notices then land in the
  // new language. The notices themselves go through
  // `useUIStore.pushStatusNotice({ messageKey })` (deferred
  // translation), so we don't actually need the `t` function inside
  // `importFromHash`. Subscribing here keeps the deps array honest.
  const { i18n } = useTranslation();
  useEffect(() => {
    if (!enabled || isSafeMode()) return;

    const handleHash = (rawHash: string) => {
      void importFromHash(rawHash);
    };

    handleHash(window.location.hash);

    const onHashChange = (event: HashChangeEvent) => {
      try {
        const url = new URL(event.newURL);
        handleHash(url.hash);
      } catch {
        // newURL should always be a valid URL on a real
        // hashchange event; if it isn't, just bail.
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [enabled, i18n.language]);
}

/**
 * Map a `ShareDecodeResult.reason` to the closed-enum telemetry
 * status. Lives outside the hook so it can be unit-tested in
 * isolation and reused by the future Phase A2 import surface.
 */
export function shareOpenStatusFromDecodeReason(
  reason: Exclude<ShareDecodeResult, { ok: true }>['reason']
): ShareOpenStatus {
  switch (reason) {
    case 'invalid-prefix':
    case 'invalid-base64':
    case 'gzip-corrupt':
    case 'json-malformed':
    case 'shape-invalid':
      return 'decode-fail';
    case 'unknown-version':
      return 'unknown-version';
    case 'unknown-language':
      return 'unknown-language';
    case 'oversized':
      return 'oversized';
  }
}

/**
 * Strip the hash from the address bar after a successful import (or
 * after a closed reject) so:
 *   1. Refreshing the page doesn't try to re-import the same link.
 *   2. The URL the user sees matches their workspace state, not the
 *      one-shot invitation that brought them here.
 *
 * Uses `replaceState` (not `pushState`) so the history doesn't grow
 * a redundant entry.
 */
function clearShareHash(): void {
  if (typeof window === 'undefined' || !window.history) return;
  const url = `${window.location.pathname}${window.location.search}`;
  try {
    window.history.replaceState(null, '', url);
  } catch {
    // history is read-only in some sandboxed iframes — fall back to
    // setting `location.hash` to a single space (cheapest cleanup).
    try {
      window.location.hash = '';
    } catch {
      // Give up silently — worst case the user sees the failing
      // notice again on next reload.
    }
  }
}

async function importFromHash(rawHash: string): Promise<void> {
  if (!rawHash || rawHash === '#') return;
  const fragment = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
  if (!fragment.startsWith(SHARE_FRAGMENT_PREFIX)) {
    // Hash present but not ours — leave it alone. Some downstream
    // surfaces (deep-link routes, anchor links) may legitimately
    // own the hash.
    return;
  }

  const sizeBucket = bucketShareSize(fragment.length);
  const result = await decodeShareFragment(fragment);
  if (!result.ok) {
    const status = shareOpenStatusFromDecodeReason(result.reason);
    pushShareImportFailure(result);
    trackShareOpened({ status, sizeBucket });
    clearShareHash();
    return;
  }

  const payload = result.payload;
  const editor = useEditorStore.getState();
  const base = createDefaultTab(payload.tab.language as Language);
  const newTab = {
    ...base,
    name: payload.tab.name,
    content: payload.source.content,
    runtimeMode: payload.modes?.runtime ?? base.runtimeMode,
    workflowMode: payload.modes?.workflow ?? base.workflowMode,
    autoLogEnabled: payload.modes?.autoLog ?? base.autoLogEnabled,
    stdinBuffer: payload.input?.stdin ?? base.stdinBuffer,
  };
  // `addTab` strips fields the language can't carry (e.g. autoLog on
  // a Python tab) — defensive layering keeps the import honest.
  editor.addTab(newTab);
  const didOpenTab = useEditorStore
    .getState()
    .tabs.some((tab) => tab.id === newTab.id);
  if (!didOpenTab) {
    // `addTab` can refuse the import for tier gates (Free tab budget,
    // unsupported paid languages). In that case it already pushed the
    // user-facing upsell notice; do not overwrite it with a false
    // success toast. Still clear the one-shot hash to avoid a reload loop.
    clearShareHash();
    return;
  }

  useUIStore.getState().pushStatusNotice({
    tone: 'info',
    messageKey: 'share.notice.imported',
  });
  trackShareOpened({ status: 'success', sizeBucket });
  clearShareHash();
}

function pushShareImportFailure(
  result: Exclude<ShareDecodeResult, { ok: true }>
): void {
  const ui = useUIStore.getState();
  switch (result.reason) {
    case 'unknown-language':
      ui.pushStatusNotice({
        tone: 'warning',
        messageKey: 'share.notice.unknownLanguage',
        values: { language: result.detail ?? 'unknown' },
      });
      return;
    case 'unknown-version':
      ui.pushStatusNotice({
        tone: 'warning',
        messageKey: 'share.notice.unknownVersion',
        values: { version: result.detail ?? 'unknown' },
      });
      return;
    case 'oversized':
      ui.pushStatusNotice({
        tone: 'warning',
        messageKey: 'share.notice.tooLarge',
      });
      return;
    case 'invalid-prefix':
    case 'invalid-base64':
    case 'gzip-corrupt':
    case 'json-malformed':
    case 'shape-invalid':
      ui.pushStatusNotice({
        tone: 'warning',
        messageKey: 'share.notice.decodeFailed',
      });
      return;
  }
}
