import { useEffect, useState, type ComponentType } from 'react';
import { useStatusNotice } from '../../hooks/useStatusNotice';
import { useAiEditSelectionStore } from '../../stores/aiEditSelectionStore';
import type { EditWithAiDialogProps } from './EditWithAiDialog';

type EditWithAiDialogComponent = ComponentType<EditWithAiDialogProps>;

let dialogPromise: Promise<{ EditWithAiDialog: EditWithAiDialogComponent }> | null = null;

/** Mounted once near the root; the dialog, its request builder and the preview runners load on the first request. */
export function AiEditSelectionHost() {
  const request = useAiEditSelectionStore(s => s.request);
  const close = useAiEditSelectionStore(s => s.close);
  const { error: pushErrorNotice } = useStatusNotice();
  const [Dialog, setDialog] = useState<EditWithAiDialogComponent | null>(null);

  useEffect(() => {
    if (!request || Dialog) return;
    let active = true;
    dialogPromise ??= import('./EditWithAiDialog');
    void dialogPromise
      .then(module => {
        if (active) setDialog(() => module.EditWithAiDialog);
      })
      .catch((error: unknown) => {
        dialogPromise = null;
        console.error('[ai] failed to load the edit-with-AI dialog', error);
        pushErrorNotice('ai.explainCode.loadFailed');
        useAiEditSelectionStore.getState().close();
      });
    return () => {
      active = false;
    };
  }, [Dialog, pushErrorNotice, request]);

  if (!request || !Dialog) return null;
  return <Dialog key={`${request.modelUri}:${request.versionId}:${request.start}:${request.end}`} request={request} onClose={close} />;
}
