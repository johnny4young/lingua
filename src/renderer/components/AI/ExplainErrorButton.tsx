/**
 * T19 — reusable "Explain this error" trigger.
 *
 * Renders nothing without the `LOCAL_AI` entitlement, so a Free user never
 * sees it. Owns the open state and mounts the consent-gated
 * `ExplainErrorDialog`, so a host surface only supplies the error text + the
 * code context. Shared by the notebook cell row, the SQL result band, the
 * editor console, and the HTTP workspace so every surface gets the identical
 * gate, focus ring, and consent flow.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { ExplainErrorDialog } from './ExplainErrorDialog';
import { useEntitlement } from '../../hooks/useEntitlement';
import type { runChatCompletion } from '../../runtime/aiClient';

export interface ExplainErrorButtonProps {
  readonly errorMessage: string;
  readonly code: string;
  readonly language: string;
  readonly filename?: string;
  /** Distinguishes the trigger per surface (notebook / sql / console / http). */
  readonly testId?: string;
  /** Extra classes appended to the host surface's layout. */
  readonly className?: string;
  /** Test seam forwarded to the dialog so component tests never hit the network. */
  readonly runChatCompletionImpl?: typeof runChatCompletion;
}

export function ExplainErrorButton({
  errorMessage,
  code,
  language,
  filename,
  testId,
  className,
  runChatCompletionImpl,
}: ExplainErrorButtonProps) {
  const { t } = useTranslation();
  const entitled = useEntitlement('LOCAL_AI');
  const [open, setOpen] = useState(false);

  // No entitlement → the feature does not exist for this user. Returning null
  // (rather than a disabled/upsell button) keeps the trigger invisible on
  // Free, matching the notebook behavior the feature shipped with.
  if (!entitled) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid={testId ?? 'explain-error-trigger'}
        className={`focus-ring inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-micro text-fg-muted hover:text-fg${
          className ? ` ${className}` : ''
        }`}
      >
        <Sparkles size={12} aria-hidden="true" />
        {t('ai.explain.title')}
      </button>
      {open ? (
        <ExplainErrorDialog
          errorMessage={errorMessage}
          code={code}
          language={language}
          {...(filename ? { filename } : {})}
          {...(runChatCompletionImpl ? { runChatCompletionImpl } : {})}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
