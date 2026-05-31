/**
 * HTTP workspace usability upgrade — Params sub-tab.
 *
 * A key/value/enabled table for URL query params kept in two-way sync
 * with the URL bar. Editing a row rebuilds the URL (`paramsToUrl`);
 * editing the URL re-seeds the rows (handled by the editor via
 * `urlToParams`). The shape mirrors the Headers table so the two read
 * the same way.
 */

import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HttpQueryParam } from '../../../shared/httpWorkspace';

export interface HttpParamsTabProps {
  params: ReadonlyArray<HttpQueryParam>;
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<HttpQueryParam>) => void;
  onRemove: (index: number) => void;
}

export function HttpParamsTab({
  params,
  onAdd,
  onUpdate,
  onRemove,
}: HttpParamsTabProps) {
  const { t } = useTranslation();
  return (
    <section data-testid="http-request-editor-params">
      <header className="flex items-center gap-2">
        <span className="text-[11.5px] font-semibold text-fg-base">
          {t('httpWorkspace.editor.params.label')}
        </span>
        <button
          type="button"
          onClick={onAdd}
          data-testid="http-request-editor-params-add"
          aria-label={t('httpWorkspace.editor.params.add')}
          title={t('httpWorkspace.editor.params.add')}
          className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-border-subtle text-fg-subtle transition-colors hover:bg-bg-inset hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          <Plus size={12} aria-hidden="true" />
        </button>
        {params.length === 0 ? (
          <span className="text-[11px] text-fg-subtle">
            {t('httpWorkspace.editor.params.empty')}
          </span>
        ) : null}
      </header>
      <ul role="list" className="mt-1 flex flex-col gap-1">
        {params.map((p, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={p.enabled}
              onChange={(event) => onUpdate(i, { enabled: event.target.checked })}
              data-testid="http-request-editor-param-enabled"
              aria-label={t('httpWorkspace.editor.params.enabledAria', {
                name: p.key,
              })}
            />
            <input
              type="text"
              value={p.key}
              onChange={(event) => onUpdate(i, { key: event.target.value })}
              placeholder={t('httpWorkspace.editor.params.name.placeholder')}
              aria-label={t('httpWorkspace.editor.params.name.placeholder')}
              data-testid="http-request-editor-param-name"
              className="h-7 w-36 rounded-md border border-border-subtle bg-bg-inset px-2 font-mono text-[11px] text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
            />
            <input
              type="text"
              value={p.value}
              onChange={(event) => onUpdate(i, { value: event.target.value })}
              placeholder={t('httpWorkspace.editor.params.value.placeholder')}
              aria-label={t('httpWorkspace.editor.params.value.placeholder')}
              data-testid="http-request-editor-param-value"
              className="h-7 min-w-0 flex-1 rounded-md border border-border-subtle bg-bg-inset px-2 font-mono text-[11px] text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
            />
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label={t('httpWorkspace.editor.params.remove.aria')}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-fg-subtle transition-colors hover:text-error-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              <Trash2 size={11} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
