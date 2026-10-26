import { ChevronDown, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HTTP_CODEGEN_LABELS, HTTP_CODEGEN_TARGETS, type HttpCodegenTarget } from '../../../shared/httpCodegen';

export type HttpCopyFormat = 'curl' | HttpCodegenTarget;

// Copy-as menu formats. Labels are library / tool names (cURL, fetch,
// axios, requests) — proper nouns, not translatable UI copy — so they
// live as constants rather than i18n keys.
const COPY_FORMATS: ReadonlyArray<{
  id: HttpCopyFormat;
  label: string;
}> = [
  { id: 'curl', label: 'cURL' },
  ...HTTP_CODEGEN_TARGETS.map(target => ({
    id: target,
    label: HTTP_CODEGEN_LABELS[target],
  })),
];

/** Copy-as menu — cURL + code snippets (fetch / axios / Python). */
export function HttpCopyAsMenu({ disabled, onCopy }: { disabled: boolean; onCopy: (format: HttpCopyFormat) => void }) {
  const { t } = useTranslation();
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const copyMenuRef = useRef<HTMLDivElement | null>(null);
  // Close the copy menu on outside click / Escape.
  useEffect(() => {
    if (!copyMenuOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!copyMenuRef.current?.contains(event.target as Node)) {
        setCopyMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setCopyMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [copyMenuOpen]);

  return (
    <div ref={copyMenuRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setCopyMenuOpen(open => !open)}
        disabled={disabled}
        data-testid="http-request-editor-copy-menu"
        aria-haspopup="menu"
        aria-expanded={copyMenuOpen}
        aria-label={t('httpWorkspace.editor.copyAs.label')}
        title={t('httpWorkspace.editor.copyAs.label')}
        className="focus-ring inline-flex h-8 items-center justify-center gap-0.5 rounded-md border border-border-subtle px-2 text-fg-subtle transition-colors hover:bg-bg-inset hover:text-fg-base disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Copy size={14} aria-hidden="true" />
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {copyMenuOpen ? (
        <div
          role="menu"
          data-testid="http-request-editor-copy-menu-list"
          className="absolute right-0 top-9 z-20 min-w-[180px] overflow-hidden rounded-md border border-border-subtle bg-bg-base py-1 shadow-e3"
        >
          {COPY_FORMATS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              data-testid={`http-request-editor-copy-${id}`}
              onClick={() => {
                setCopyMenuOpen(false);
                onCopy(id);
              }}
              className="focus-ring block w-full px-3 py-1.5 text-left text-body-sm text-fg-base hover:bg-bg-inset focus-visible:bg-bg-inset"
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
