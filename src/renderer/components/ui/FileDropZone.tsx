import { useId, type ReactNode } from 'react';
import { Upload, FileCheck2, FileX2, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';
import { useFileDropZone, type FileDropState } from '../../hooks/useFileDropZone';

/**
 * RL-070 — Signal-Slate file drop zone.
 *
 * Visual states:
 *
 *   idle      → dashed border, neutral icon, hint text
 *   over      → accent border + soft tint, "Release to drop"
 *   dropping  → loader, "Reading file..."
 *   error     → error border, X icon, error message (consumer-supplied)
 *
 * Composes with a hidden file input so users without drag-drop
 * (touch devices, accessibility tooling) get the same behaviour
 * via a click. The `<label>` wraps the whole zone so click anywhere
 * inside opens the picker.
 *
 * Errors that the consumer surfaces (e.g. "File too large", "Wrong
 * type") flow through `errorMessage`; the hook flips back to `idle`
 * automatically when `onFile` resolves cleanly.
 */
interface FileDropZoneProps {
  /** Called with the dropped or picked file. Async-aware. */
  onFile: (file: File) => Promise<void> | void;
  /** Optional MIME or extension predicate. */
  accept?: (item: File | DataTransferItem) => boolean;
  /** Native file picker `accept` (e.g. ".json,.txt") for the hidden input. */
  acceptAttr?: string;
  /** Hint above the placeholder ("Drop a JSON file..."). */
  hint: ReactNode;
  /** Placeholder shown in idle state ("No file selected"). */
  placeholder?: ReactNode;
  /** Optional summary node (filename + size) when a file is loaded. */
  summary?: ReactNode;
  /** Optional consumer-driven error message to render in error state. */
  errorMessage?: string;
  /** Test id for the dropzone wrapper. */
  testId?: string;
  /** Test id for the hidden file input (assistive picker). */
  inputTestId?: string;
  /** ClassName extension for layout/sizing tweaks. */
  className?: string;
}

export function FileDropZone({
  onFile,
  accept,
  acceptAttr,
  hint,
  placeholder,
  summary,
  errorMessage,
  testId,
  inputTestId,
  className,
}: FileDropZoneProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const { state, handlers, processFile } = useFileDropZone({ onFile, accept });

  const showError = state === 'error' || Boolean(errorMessage);
  const effectiveState: FileDropState = showError ? 'error' : state;

  return (
    <label
      htmlFor={inputId}
      data-testid={testId}
      data-drop-state={effectiveState}
      className={cn(
        'group relative grid cursor-pointer gap-2 rounded-2xl border-2 border-dashed p-4 text-center text-body-sm transition-colors',
        stateClasses(effectiveState),
        className
      )}
      {...handlers}
    >
      <div className="mx-auto flex flex-col items-center gap-2">
        <DropIcon state={effectiveState} />
        <span className="font-medium">
          {effectiveState === 'over'
            ? t('ui.fileDropZone.releaseToDrop')
            : effectiveState === 'dropping'
              ? t('ui.fileDropZone.readingFile')
              : effectiveState === 'error'
                ? errorMessage ?? t('ui.fileDropZone.rejected')
                : hint}
        </span>
        {effectiveState === 'idle' && placeholder ? (
          <span className="text-muted">{placeholder}</span>
        ) : null}
        {effectiveState === 'idle' && summary ? <div>{summary}</div> : null}
      </div>
      <input
        id={inputId}
        type="file"
        accept={acceptAttr}
        aria-label={typeof hint === 'string' ? hint : undefined}
        data-testid={inputTestId}
        className="sr-only"
        onChange={(event) => {
          processFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </label>
  );
}

function stateClasses(state: FileDropState): string {
  switch (state) {
    case 'over':
      return 'border-primary bg-primary-soft text-foreground shadow-[0_0_0_4px_color-mix(in_srgb,var(--app-primary)_20%,transparent)]';
    case 'dropping':
      return 'border-primary/60 bg-primary-soft/60 text-foreground';
    case 'error':
      return 'border-error/60 bg-error/8 text-error';
    case 'idle':
    default:
      return 'border-border/80 bg-background/65 text-muted hover:border-border-strong/90 hover:text-foreground';
  }
}

function DropIcon({ state }: { state: FileDropState }) {
  if (state === 'dropping') {
    return <Loader2 size={20} className="animate-spin text-primary" aria-hidden="true" />;
  }
  if (state === 'error') {
    return <FileX2 size={20} className="text-error" aria-hidden="true" />;
  }
  if (state === 'over') {
    return <FileCheck2 size={20} className="text-primary" aria-hidden="true" />;
  }
  return <Upload size={20} className="text-muted" aria-hidden="true" />;
}
