import {
  bucketShareSize,
  decodeShareFragment,
  type ShareDecodeResult,
} from '../../shared/sharePayload';
import { createDefaultTab, useEditorStore } from '../stores/editorStore';
import { useUIStore } from '../stores/uiStore';
import { trackShareOpened, type ShareOpenStatus } from '../utils/shareLink';
import type { Language } from '../types';

function shareOpenStatusFromDecodeReason(
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

function clearShareHash(): void {
  if (typeof window === 'undefined' || !window.history) return;
  const url = `${window.location.pathname}${window.location.search}`;
  try {
    window.history.replaceState(null, '', url);
  } catch {
    try {
      window.location.hash = '';
    } catch {
      // Read-only sandboxed frames may reject both cleanup paths. Importing
      // still succeeded; the fragment can be retried only on a later reload.
    }
  }
}

function pushShareImportFailure(result: Exclude<ShareDecodeResult, { ok: true }>): void {
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

/**
 * On-demand hash-fragment decoder and tab importer. Session restore still
 * finishes before the boot hook calls this function, and every terminal
 * outcome keeps the original notice, telemetry, and one-shot hash cleanup.
 */
export async function importShareLinkHash(rawHash: string): Promise<void> {
  const fragment = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
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
  editor.addTab(newTab);
  const didOpenTab = useEditorStore.getState().tabs.some(tab => tab.id === newTab.id);
  if (!didOpenTab) {
    // addTab already owns tier-gate notices. Preserve that actionable message.
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
