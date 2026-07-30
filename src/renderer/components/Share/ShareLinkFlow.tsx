import { useCallback, useEffect, useRef, useState } from 'react';
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
import { emitCommand } from '../../stores/commandBus';
import { ShareConfirmationModal } from './ShareConfirmationModal';
import { ShareLinkLoadingDialog } from './ShareLinkLoadingDialog';

export interface ShareLinkFlowProps {
  readonly trigger: ShareCreateTrigger;
  readonly onClose: () => void;
}

/**
 * On-demand outgoing share implementation.
 *
 * The controller mounts one instance only after an explicit button, palette,
 * or shortcut request. Preparation stays confirmation-first, every terminal
 * outcome retains its existing notice/telemetry contract, and unexpected
 * codec failures now close cleanly instead of producing an unhandled promise.
 */
export function ShareLinkFlow({ trigger, onClose }: ShareLinkFlowProps) {
  const activeTab = useActiveTab();
  const pushStatusNotice = useUIStore(state => state.pushStatusNotice);
  const [pendingPreview, setPendingPreview] = useState<PreparedShareLink | null>(null);
  const [writing, setWriting] = useState(false);
  const startedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const finishWithSuccess = useCallback(
    (link: PreparedShareLink) => {
      pushStatusNotice({
        tone: 'success',
        messageKey: 'share.notice.copied',
      });
      trackShareCreated({
        trigger,
        status: 'success',
        sizeBucket: bucketShareSize(link.sizeBytes),
      });
      emitCommand('share.succeeded');
    },
    [pushStatusNotice, trigger]
  );

  const performClipboardWrite = useCallback(
    async (link: PreparedShareLink) => {
      const writeResult = await writeShareLinkToClipboard(link.url);
      if (!mountedRef.current) return;
      if (writeResult.ok) {
        finishWithSuccess(link);
        return;
      }
      pushStatusNotice({
        tone: 'warning',
        messageKey: 'share.notice.clipboardUnavailable',
      });
      trackShareCreated({
        trigger,
        status: 'cancelled',
        sizeBucket: bucketShareSize(link.sizeBytes),
      });
    },
    [finishWithSuccess, pushStatusNotice, trigger]
  );

  const prepare = useCallback(async () => {
    if (!activeTab) {
      onClose();
      return;
    }
    try {
      const prepared = await prepareShareLinkFromTab(activeTab);
      if (!mountedRef.current) return;
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
        onClose();
        return;
      }
      setPendingPreview(prepared.link);
    } catch (error: unknown) {
      if (!mountedRef.current) return;
      console.error('[share] failed to prepare a share link', error);
      pushStatusNotice({
        tone: 'warning',
        messageKey: 'share.notice.prepareFailed',
      });
      onClose();
    }
  }, [activeTab, onClose, pushStatusNotice, trigger]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void prepare();
  }, [prepare]);

  const handleModalConfirm = useCallback(async () => {
    if (!pendingPreview || writing) return;
    const link = pendingPreview;
    setPendingPreview(null);
    setWriting(true);
    try {
      await performClipboardWrite(link);
    } finally {
      if (mountedRef.current) onClose();
    }
  }, [onClose, pendingPreview, performClipboardWrite, writing]);

  const handleModalCancel = useCallback(() => {
    if (!pendingPreview) return;
    trackShareCreated({
      trigger,
      status: 'cancelled',
      sizeBucket: bucketShareSize(pendingPreview.sizeBytes),
    });
    onClose();
  }, [onClose, pendingPreview, trigger]);

  if (!pendingPreview) {
    return writing ? <ShareLinkLoadingDialog /> : <ShareLinkLoadingDialog onClose={onClose} />;
  }

  return (
    <ShareConfirmationModal
      previewContent={pendingPreview.payload.source.content}
      stdinPreview={pendingPreview.payload.input?.stdin}
      language={pendingPreview.payload.tab.language}
      sizeBytes={pendingPreview.sizeBytes}
      onConfirm={() => void handleModalConfirm()}
      onCancel={handleModalCancel}
    />
  );
}
