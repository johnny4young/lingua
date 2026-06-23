import { Check, Copy } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { writeToClipboard } from '../../utils/clipboard';

/**
 * Small discreet copy-to-clipboard affordance for Developer Utility output
 * fields. Renders as a 24x24 icon button — swaps to a checkmark for a short
 * "copied!" confirmation and back. Reads from the supplied string lazily so
 * callers pass either a plain value or a `() => string` when the text is
 * computed from an analysis object.
 */
interface CopyButtonProps {
  /** Text to copy, or a thunk when the value depends on render state. */
  value: string | (() => string);
  /** Aria label. Defaults to the localized "Copy" string. */
  label?: string;
  /** Override the testid for integration tests. */
  testid?: string;
  /** Hide the button entirely (e.g. when the output is empty). */
  disabled?: boolean;
}

export function CopyButton({ value, label, testid, disabled = false }: CopyButtonProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const resolveValue = useCallback(() => (typeof value === 'function' ? value() : value), [value]);

  const handleCopy = useCallback(async () => {
    if (disabled) return;
    const text = resolveValue();
    if (!text) return;
    const ok = await writeToClipboard(text);
    if (!ok) return;
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  }, [disabled, resolveValue]);

  const tooltip = copied
    ? t('utilities.copy.copied')
    : label ?? t('utilities.copy.label');

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      disabled={disabled}
      aria-label={tooltip}
      title={tooltip}
      data-testid={testid ?? 'copy-button'}
      data-copied={copied || undefined}
      className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-transparent text-muted transition-colors hover:border-border/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
    </button>
  );
}
