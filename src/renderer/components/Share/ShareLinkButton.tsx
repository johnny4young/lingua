import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Share2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useActiveTab } from '../../hooks/useActiveTab';
import { useUIStore } from '../../stores/uiStore';
import {
  bucketShareSize,
  prepareShareLinkFromTab,
  shareCreateStatusFromPrepareReason,
  trackShareCreated,
  writeShareLinkToClipboard,
  type PreparedShareLink,
  type ShareCreateTrigger,
} from '../../utils/shareLink';
import { ShareConfirmationModal } from './ShareConfirmationModal';
import { emitCommand } from '../../stores/commandBus';
import { useCommandListener } from '../../hooks/useCommandListener';

/**
 * RL-036 Phase A1 fold E — primary surface for "Copy share link".
 *
 * Icon-only button mounted in the result-panel header next to
 * `<RunCapsuleExportButton>` so the share affordance lives ONE click
 * from the active tab the user is editing, not behind a palette
 * lookup.
 *
 * Design choices (mirror of `<RunCapsuleExportButton>`):
 *
 *   - **Lazy render to `null` when no active tab exists.** Without a
 *     tab there is nothing to share; surfacing a disabled button
 *     would advertise an action that doesn't exist.
 *   - **Two-stage flow gated by `shareLinkConfirmEnabled` (fold F).**
 *     Click → prepare the share link in memory → if the setting is
 *     ON show `<ShareConfirmationModal>` with source + stdin previews;
 *     the user must confirm before the URL lands on the clipboard. When
 *     the setting is OFF (user explicitly opted out) the clipboard
 *     write fires directly. Cancelling the modal fires
 *     `share.created { status: 'cancelled' }` so adoption can be
 *     measured.
 *   - **1-second visual feedback on click.** Swap the `Share2` icon
 *     for a `Check` for 1s, then revert. Same pattern as the
 *     existing `<RunCapsuleExportButton>`.
 *   - **Telemetry on every terminal outcome** (success / cancelled /
 *     too-large / unknown-language). Clipboard failures are counted as
 *     cancelled because the user did not receive a usable link. Closed-enum
 *     payload validated against `SHARE_CREATE_*` sets.
 */

const FEEDBACK_RESET_MS = 1000;
let shareFlowInFlight = false;

function claimShareFlow(): boolean {
  if (shareFlowInFlight) return false;
  shareFlowInFlight = true;
  return true;
}

function releaseShareFlow(): void {
  shareFlowInFlight = false;
}

function useShareLinkFlow() {
  const activeTab = useActiveTab();
  const pushStatusNotice = useUIStore(state => state.pushStatusNotice);
  // Slice 2 — `shareLinkConfirmEnabled` removed; the confirmation
  // modal is now the only path. Safer default for clipboard writes.
  const shareLinkConfirmEnabled = true;

  const [justCopied, setJustCopied] = useState(false);
  const [pendingPreview, setPendingPreview] = useState<PreparedShareLink | null>(null);
  /**
   * The trigger that initiated the currently-pending preview. Kept
   * separate from `pendingPreview` so cancelling the modal can fire
   * the correct telemetry attribution (e.g. cancelling a palette-
   * triggered modal records the cancel against `trigger: 'palette'`).
   */
  const [pendingTrigger, setPendingTrigger] = useState<ShareCreateTrigger>('button');
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Concurrent-encode guard. Without it a rapid double-trigger (e.g.
   * keyboard shortcut + button click while gzip is in flight) would
   * race two `setPendingPreview` calls and silently drop the first
   * trigger's telemetry. Mirrors the in-flight pattern from
   * `useGlobalShortcuts.copyShareLink`. `useRef` so the guard is
   * tracked in the component instance, not React state — flipping
   * it must not re-render.
   */
  const encodeInFlightRef = useRef(false);

  useEffect(() => {
    // Cleanup feedback timer + pending preview if the component
    // unmounts mid-cycle (e.g. user navigates away while modal is open).
    return () => {
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
      if (encodeInFlightRef.current) {
        encodeInFlightRef.current = false;
        releaseShareFlow();
      }
    };
  }, []);

  const finishWithSuccess = useCallback(
    (link: PreparedShareLink, trigger: ShareCreateTrigger) => {
      pushStatusNotice({
        tone: 'success',
        messageKey: 'share.notice.copied',
      });
      setJustCopied(true);
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = setTimeout(() => {
        setJustCopied(false);
        resetTimerRef.current = null;
      }, FEEDBACK_RESET_MS);
      trackShareCreated({
        trigger,
        status: 'success',
        sizeBucket: bucketShareSize(link.sizeBytes),
      });
      // Signal sibling surfaces (e.g. `<ShareLinkButton>`) that
      // want to flash a success indicator without owning the share
      // flow themselves.
      emitCommand('share.succeeded');
    },
    [pushStatusNotice]
  );

  const performClipboardWrite = useCallback(
    async (link: PreparedShareLink, trigger: ShareCreateTrigger) => {
      const writeResult = await writeShareLinkToClipboard(link.url);
      if (writeResult.ok) {
        finishWithSuccess(link, trigger);
        return;
      }
      pushStatusNotice({
        tone: 'warning',
        messageKey: 'share.notice.clipboardUnavailable',
      });
      // Clipboard failure: count it as `cancelled` for the share-
      // adoption signal — the user did NOT receive a usable link, so
      // it would mislead the dashboard to count it as 'success'.
      trackShareCreated({
        trigger,
        status: 'cancelled',
        sizeBucket: bucketShareSize(link.sizeBytes),
      });
    },
    [finishWithSuccess, pushStatusNotice]
  );

  const runShareFlow = useCallback(
    async (trigger: ShareCreateTrigger) => {
      if (!activeTab) return;
      // Concurrent-flow guard: drop the second invocation while the
      // first encode + modal cycle is still pending. The modal flow
      // owns its own dismiss path; a second click does nothing rather
      // than racing a competing preview into the same slot. The guard
      // is released either here in `finally` (non-modal paths) or by
      // the modal confirm / cancel handler (modal path).
      if (encodeInFlightRef.current || !claimShareFlow()) return;
      encodeInFlightRef.current = true;
      let modalOpenedThisFlow = false;
      try {
        const prepared = await prepareShareLinkFromTab(activeTab);
        if (!prepared.ok) {
          const status = shareCreateStatusFromPrepareReason(prepared.reason);
          pushStatusNotice({
            tone: 'warning',
            messageKey:
              status === 'too-large' ? 'share.notice.tooLarge' : 'share.notice.unknownLanguage',
            values: status === 'unknown-language' ? { language: activeTab.language } : undefined,
          });
          trackShareCreated({
            trigger,
            status,
            sizeBucket: bucketShareSize(prepared.sizeBytes),
          });
          return;
        }
        if (shareLinkConfirmEnabled) {
          setPendingPreview(prepared.link);
          setPendingTrigger(trigger);
          modalOpenedThisFlow = true;
          return;
        }
        await performClipboardWrite(prepared.link, trigger);
      } finally {
        // Only release the guard when the flow is fully terminated.
        // When the modal opens, the cycle continues across user
        // confirm / cancel and the handlers below release the guard
        // themselves.
        if (!modalOpenedThisFlow) {
          encodeInFlightRef.current = false;
          releaseShareFlow();
        }
      }
    },
    [activeTab, pushStatusNotice, shareLinkConfirmEnabled, performClipboardWrite]
  );

  const handleModalConfirm = useCallback(async () => {
    if (!pendingPreview) return;
    const link = pendingPreview;
    const trigger = pendingTrigger;
    setPendingPreview(null);
    try {
      await performClipboardWrite(link, trigger);
    } finally {
      encodeInFlightRef.current = false;
      releaseShareFlow();
    }
  }, [pendingPreview, pendingTrigger, performClipboardWrite]);

  const handleModalCancel = useCallback(() => {
    if (!pendingPreview) return;
    const link = pendingPreview;
    const trigger = pendingTrigger;
    setPendingPreview(null);
    trackShareCreated({
      trigger,
      status: 'cancelled',
      sizeBucket: bucketShareSize(link.sizeBytes),
    });
    encodeInFlightRef.current = false;
    releaseShareFlow();
  }, [pendingPreview, pendingTrigger]);

  const modal = pendingPreview ? (
    <ShareConfirmationModal
      previewContent={pendingPreview.payload.source.content}
      stdinPreview={pendingPreview.payload.input?.stdin}
      language={pendingPreview.payload.tab.language}
      sizeBytes={pendingPreview.sizeBytes}
      onConfirm={() => void handleModalConfirm()}
      onCancel={handleModalCancel}
    />
  ) : null;

  return {
    activeTab,
    justCopied,
    runShareFlow,
    modal,
  };
}

export function ShareLinkController() {
  const { runShareFlow, modal } = useShareLinkFlow();

  // Listen for the typed cross-component command from the palette
  // (fold C) and keyboard shortcut (fold D). This controller is
  // mounted at AppChrome scope, so those paths keep working even when
  // the result panel is hidden and the header button is not mounted.
  useCommandListener('share.trigger', ({ trigger }) => {
    void runShareFlow(trigger);
  });

  return modal;
}

export function ShareLinkButton() {
  const { t } = useTranslation();
  // Button-side state only: render the icon and gate on `activeTab`.
  // The share flow + confirmation modal live in `<ShareLinkController>`
  // (mounted at AppChrome scope) so button, palette, and shortcut triggers
  // share one modal owner and one concurrency guard. The modal itself portals
  // to document.body for stacking safety.
  const activeTab = useActiveTab();
  const [justCopied, setJustCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Listen for the success signal the controller emits after the
  // clipboard write resolves. Lets us flash the Check icon without
  // duplicating the share flow inside the button.
  useCommandListener('share.succeeded', () => {
    setJustCopied(true);
    if (resetTimerRef.current !== null) {
      clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = setTimeout(() => {
      setJustCopied(false);
      resetTimerRef.current = null;
    }, FEEDBACK_RESET_MS);
  });

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
      }
    },
    []
  );

  const handleClick = useCallback(() => {
    emitCommand('share.trigger', { trigger: 'button' });
  }, []);

  if (!activeTab) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      title={t('share.button.tooltip')}
      aria-label={t('share.button.aria')}
      data-testid="result-panel-share-link"
      data-just-copied={justCopied ? 'true' : 'false'}
      className={`relative button-secondary inline-flex items-center justify-center px-2 py-1 ${
        justCopied ? 'ring-2 ring-primary/60 ring-offset-1 ring-offset-bg-panel-alt' : ''
      }`}
    >
      {justCopied ? (
        <Check size={13} aria-hidden="true" />
      ) : (
        <Share2 size={13} aria-hidden="true" />
      )}
    </button>
  );
}
