import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { useCommandListener } from '../../hooks/useCommandListener';
import { useStatusNotice } from '../../hooks/useStatusNotice';
import type { ShareCreateTrigger } from '../../utils/shareLink';
import { ShareLinkLoadingDialog } from './ShareLinkLoadingDialog';
import type { ShareLinkFlowProps } from './ShareLinkFlow';
import { loadShareLinkFlow } from './shareLinkFlowLoader';

type ShareLinkFlowComponent = ComponentType<ShareLinkFlowProps>;

interface ShareRequest {
  readonly id: number;
  readonly trigger: ShareCreateTrigger;
}

/**
 * Single startup-safe owner for button, palette, and shortcut share commands.
 *
 * A request renders immediate localized feedback, then loads the encoder,
 * telemetry, clipboard flow, and confirmation modal behind one retryable
 * boundary. While a request is active, duplicate triggers are ignored so they
 * cannot race two previews into the same modal slot.
 */
export function ShareLinkController() {
  const [request, setRequest] = useState<ShareRequest | null>(null);
  const [Flow, setFlow] = useState<ShareLinkFlowComponent | null>(null);
  const nextRequestIdRef = useRef(1);
  const loadPendingRef = useRef(false);
  const mountedRef = useRef(true);
  const activeRequestRef = useRef<ShareRequest | null>(null);
  const { error: pushErrorNotice } = useStatusNotice();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeRequestRef.current = null;
    };
  }, []);

  useCommandListener('share.trigger', ({ trigger }) => {
    if (activeRequestRef.current) return;
    const id = nextRequestIdRef.current;
    nextRequestIdRef.current += 1;
    const nextRequest = { id, trigger };
    activeRequestRef.current = nextRequest;
    setRequest(nextRequest);
  });

  useEffect(() => {
    if (!request || Flow || loadPendingRef.current) return;

    loadPendingRef.current = true;
    void loadShareLinkFlow()
      .then(module => {
        if (!mountedRef.current) return;
        setFlow(() => module.ShareLinkFlow);
      })
      .catch((error: unknown) => {
        if (!mountedRef.current || !activeRequestRef.current) return;
        console.error('[share] failed to load the share-link flow', error);
        pushErrorNotice('share.notice.loadFailed');
        activeRequestRef.current = null;
        setRequest(null);
      })
      .finally(() => {
        loadPendingRef.current = false;
      });
  }, [Flow, pushErrorNotice, request]);

  const close = useCallback(() => {
    activeRequestRef.current = null;
    setRequest(null);
  }, []);

  if (!request) return null;
  if (!Flow) return <ShareLinkLoadingDialog onClose={close} />;

  return <Flow key={request.id} trigger={request.trigger} onClose={close} />;
}
