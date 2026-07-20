/**
 * internal — Assertions sub-tab (Postman-style tests, evaluated locally).
 *
 * A table of post-response assertions. After a request settles, each
 * enabled row reads a value from the response (status, a header, a JSON
 * body path, or the round-trip time) and checks it against `expected`
 * with a comparator. The rules live on the request (persist + export
 * with it); evaluating them is the response preview's job on settle.
 */

import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  HttpAssertion,
  HttpAssertionComparator,
  HttpAssertionSource,
} from '../../../shared/httpWorkspace';

export interface HttpAssertionsTabProps {
  assertions: ReadonlyArray<HttpAssertion>;
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<HttpAssertion>) => void;
  onRemove: (index: number) => void;
}

const ASSERTION_SOURCES: ReadonlyArray<{ id: HttpAssertionSource; labelKey: string }> = [
  { id: 'status', labelKey: 'httpWorkspace.editor.assert.source.status' },
  { id: 'header', labelKey: 'httpWorkspace.editor.assert.source.header' },
  { id: 'body-json', labelKey: 'httpWorkspace.editor.assert.source.bodyJson' },
  { id: 'response-time', labelKey: 'httpWorkspace.editor.assert.source.responseTime' },
];

const ASSERTION_COMPARATORS: ReadonlyArray<{
  id: HttpAssertionComparator;
  labelKey: string;
}> = [
  { id: 'equals', labelKey: 'httpWorkspace.editor.assert.cmp.equals' },
  { id: 'not-equals', labelKey: 'httpWorkspace.editor.assert.cmp.notEquals' },
  { id: 'contains', labelKey: 'httpWorkspace.editor.assert.cmp.contains' },
  { id: 'exists', labelKey: 'httpWorkspace.editor.assert.cmp.exists' },
  { id: 'not-exists', labelKey: 'httpWorkspace.editor.assert.cmp.notExists' },
  { id: 'less-than', labelKey: 'httpWorkspace.editor.assert.cmp.lessThan' },
  { id: 'greater-than', labelKey: 'httpWorkspace.editor.assert.cmp.greaterThan' },
];

/** Source rows that don't take a path (status / response-time). */
function usesPath(source: HttpAssertionSource): boolean {
  return source === 'header' || source === 'body-json';
}

/** Comparators that don't take an expected value (exists / not-exists). */
function usesExpected(comparator: HttpAssertionComparator): boolean {
  return comparator !== 'exists' && comparator !== 'not-exists';
}

export function HttpAssertionsTab({
  assertions,
  onAdd,
  onUpdate,
  onRemove,
}: HttpAssertionsTabProps) {
  const { t } = useTranslation();
  return (
    <section data-testid="http-request-editor-assert">
      <header className="flex items-center gap-2">
        <span className="text-caption font-semibold text-fg-base">
          {t('httpWorkspace.editor.assert.label')}
        </span>
        <button
          type="button"
          onClick={onAdd}
          data-testid="http-request-editor-assert-add"
          aria-label={t('httpWorkspace.editor.assert.add')}
          title={t('httpWorkspace.editor.assert.add')}
          className="focus-ring inline-flex h-5 w-5 items-center justify-center rounded-md border border-border-subtle text-fg-subtle transition-colors hover:bg-bg-inset hover:text-fg-base"
        >
          <Plus size={12} aria-hidden="true" />
        </button>
      </header>
      <p className="mt-1 text-eyebrow leading-relaxed text-fg-subtle">
        {t('httpWorkspace.editor.assert.hint')}
      </p>
      {assertions.length === 0 ? (
        <p
          data-testid="http-request-editor-assert-empty"
          className="mt-1 text-caption text-fg-subtle"
        >
          {t('httpWorkspace.editor.assert.empty')}
        </p>
      ) : (
        <ul role="list" className="mt-1.5 flex flex-col gap-1">
          {assertions.map((assertion, i) => (
            <li key={assertion.id} className="flex min-w-0 items-start gap-1.5">
              <input
                type="checkbox"
                checked={assertion.enabled}
                onChange={event => onUpdate(i, { enabled: event.target.checked })}
                data-testid="http-request-editor-assert-enabled"
                className="mt-1.5 shrink-0"
                aria-label={t('httpWorkspace.editor.assert.enabledAria', {
                  index: i + 1,
                })}
              />
              <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
                <select
                  value={assertion.source}
                  onChange={event =>
                    onUpdate(i, { source: event.target.value as HttpAssertionSource })
                  }
                  data-testid="http-request-editor-assert-source"
                  aria-label={t('httpWorkspace.editor.assert.sourceAria', { index: i + 1 })}
                  className="h-7 min-w-0 rounded-md border border-border-subtle bg-bg-inset px-1.5 text-caption text-fg-base focus:border-border-strong focus:outline-none"
                >
                  {ASSERTION_SOURCES.map(source => (
                    <option key={source.id} value={source.id}>
                      {t(source.labelKey)}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={assertion.path}
                  onChange={event => onUpdate(i, { path: event.target.value })}
                  disabled={!usesPath(assertion.source)}
                  placeholder={t(
                    assertion.source === 'header'
                      ? 'httpWorkspace.editor.assert.path.headerPlaceholder'
                      : 'httpWorkspace.editor.assert.path.jsonPlaceholder'
                  )}
                  aria-label={t('httpWorkspace.editor.assert.pathAria', { index: i + 1 })}
                  data-testid="http-request-editor-assert-path"
                  className="h-7 min-w-0 rounded-md border border-border-subtle bg-bg-inset px-2 font-mono text-caption text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                />
                <select
                  value={assertion.comparator}
                  onChange={event =>
                    onUpdate(i, {
                      comparator: event.target.value as HttpAssertionComparator,
                    })
                  }
                  data-testid="http-request-editor-assert-comparator"
                  aria-label={t('httpWorkspace.editor.assert.comparatorAria', {
                    index: i + 1,
                  })}
                  className="h-7 min-w-0 rounded-md border border-border-subtle bg-bg-inset px-1.5 text-caption text-fg-base focus:border-border-strong focus:outline-none"
                >
                  {ASSERTION_COMPARATORS.map(cmp => (
                    <option key={cmp.id} value={cmp.id}>
                      {t(cmp.labelKey)}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={assertion.expected}
                  onChange={event => onUpdate(i, { expected: event.target.value })}
                  disabled={!usesExpected(assertion.comparator)}
                  placeholder={t('httpWorkspace.editor.assert.expected.placeholder')}
                  aria-label={t('httpWorkspace.editor.assert.expectedAria', { index: i + 1 })}
                  data-testid="http-request-editor-assert-expected"
                  className="h-7 min-w-0 rounded-md border border-border-subtle bg-bg-inset px-2 font-mono text-caption text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
              <button
                type="button"
                onClick={() => onRemove(i)}
                aria-label={t('httpWorkspace.editor.assert.remove.aria', { index: i + 1 })}
                className="focus-ring inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:text-error-fg"
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
