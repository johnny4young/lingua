import { useAiExplainCodeStore } from '../../stores/aiExplainCodeStore';
import { ExplainCodeDialog } from './ExplainCodeDialog';

/**
 * SR-20a (Wave 4) — single mount point for the "Explain this code" dialog.
 * Renders it whenever the store holds an open request, so both the editor
 * context-menu action and the command-palette command open the same
 * dialog. Mounted once near the app root.
 */
export function AiExplainCodeHost() {
  const request = useAiExplainCodeStore((s) => s.request);
  const close = useAiExplainCodeStore((s) => s.close);

  if (!request) return null;

  return (
    <ExplainCodeDialog
      code={request.code}
      language={request.language}
      filename={request.filename}
      onClose={close}
    />
  );
}
