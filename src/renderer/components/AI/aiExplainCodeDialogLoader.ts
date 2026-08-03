import type { ComponentType } from 'react';
import type { ExplainCodeDialogProps } from './ExplainCodeDialog';

interface AiExplainCodeDialogModule {
  ExplainCodeDialog: ComponentType<ExplainCodeDialogProps>;
}

let dialogPromise: Promise<AiExplainCodeDialogModule> | null = null;

export function loadAiExplainCodeDialog(): Promise<AiExplainCodeDialogModule> {
  dialogPromise ??= import('./ExplainCodeDialog');
  return dialogPromise.catch((error: unknown) => {
    dialogPromise = null;
    throw error;
  });
}
