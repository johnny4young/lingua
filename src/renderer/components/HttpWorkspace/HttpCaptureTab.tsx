/**
 * T2 — Capture sub-tab (request chaining).
 *
 * A table of post-response capture rules. After a request succeeds, each
 * enabled rule reads a value from the response (a JSON body path, a
 * response header, or the status code) and writes it into the named
 * variable of the ACTIVE environment — so a login response's token can
 * feed the next authenticated request via `{{TOKEN}}`. The rules live on
 * the request (persist + export with it); applying them is the panel's
 * job on a successful settle.
 */

import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  HttpCaptureRule,
  HttpCaptureSource,
} from '../../../shared/httpWorkspace';

export interface HttpCaptureTabProps {
  captures: ReadonlyArray<HttpCaptureRule>;
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<HttpCaptureRule>) => void;
  onRemove: (index: number) => void;
}

// Module-level so the JSX never carries a bare copy literal (renderer
// copy guard) and the option order stays a single source of truth.
const CAPTURE_SOURCES: ReadonlyArray<{ id: HttpCaptureSource; labelKey: string }> = [
  { id: 'body-json', labelKey: 'httpWorkspace.editor.capture.source.bodyJson' },
  { id: 'header', labelKey: 'httpWorkspace.editor.capture.source.header' },
  { id: 'status', labelKey: 'httpWorkspace.editor.capture.source.status' },
];

export function HttpCaptureTab({
  captures,
  onAdd,
  onUpdate,
  onRemove,
}: HttpCaptureTabProps) {
  const { t } = useTranslation();
  return (
    <section data-testid="http-request-editor-capture">
      <header className="flex items-center gap-2">
        <span className="text-caption font-semibold text-fg-base">
          {t('httpWorkspace.editor.capture.label')}
        </span>
        <button
          type="button"
          onClick={onAdd}
          data-testid="http-request-editor-capture-add"
          aria-label={t('httpWorkspace.editor.capture.add')}
          title={t('httpWorkspace.editor.capture.add')}
          className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-border-subtle text-fg-subtle transition-colors hover:bg-bg-inset hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          <Plus size={12} aria-hidden="true" />
        </button>
      </header>
      <p className="mt-1 text-eyebrow leading-relaxed text-fg-subtle">
        {t('httpWorkspace.editor.capture.hint')}
      </p>
      {captures.length === 0 ? (
        <p
          data-testid="http-request-editor-capture-empty"
          className="mt-1 text-caption text-fg-subtle"
        >
          {t('httpWorkspace.editor.capture.empty')}
        </p>
      ) : (
        <ul role="list" className="mt-1.5 flex flex-col gap-1">
          {captures.map((capture, i) => (
            <li key={capture.id} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={capture.enabled}
                onChange={(event) => onUpdate(i, { enabled: event.target.checked })}
                data-testid="http-request-editor-capture-enabled"
                aria-label={t('httpWorkspace.editor.capture.enabledAria', {
                  name: capture.targetVariable || capture.path,
                })}
              />
              <select
                value={capture.source}
                onChange={(event) =>
                  onUpdate(i, { source: event.target.value as HttpCaptureSource })
                }
                data-testid="http-request-editor-capture-source"
                aria-label={t('httpWorkspace.editor.capture.sourceAria')}
                className="h-7 rounded-md border border-border-subtle bg-bg-inset px-1.5 text-caption text-fg-base focus:border-border-strong focus:outline-none"
              >
                {CAPTURE_SOURCES.map((source) => (
                  <option key={source.id} value={source.id}>
                    {t(source.labelKey)}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={capture.path}
                onChange={(event) => onUpdate(i, { path: event.target.value })}
                disabled={capture.source === 'status'}
                placeholder={t(
                  capture.source === 'header'
                    ? 'httpWorkspace.editor.capture.path.headerPlaceholder'
                    : 'httpWorkspace.editor.capture.path.jsonPlaceholder'
                )}
                aria-label={t('httpWorkspace.editor.capture.pathAria')}
                data-testid="http-request-editor-capture-path"
                className="h-7 w-40 rounded-md border border-border-subtle bg-bg-inset px-2 font-mono text-caption text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              />
              <span aria-hidden="true" className="text-caption text-fg-subtle">
                →
              </span>
              <input
                type="text"
                value={capture.targetVariable}
                onChange={(event) =>
                  onUpdate(i, { targetVariable: event.target.value })
                }
                placeholder={t('httpWorkspace.editor.capture.target.placeholder')}
                aria-label={t('httpWorkspace.editor.capture.targetAria')}
                data-testid="http-request-editor-capture-target"
                className="h-7 min-w-0 flex-1 rounded-md border border-border-subtle bg-bg-inset px-2 font-mono text-caption text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
              />
              <button
                type="button"
                onClick={() => onRemove(i)}
                aria-label={t('httpWorkspace.editor.capture.remove.aria')}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-fg-subtle transition-colors hover:text-error-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
              >
                <Trash2 size={11} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
