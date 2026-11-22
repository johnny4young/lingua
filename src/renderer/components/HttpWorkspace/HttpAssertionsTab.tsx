/**
 * Tests sub-tab: post-response checks evaluated locally.
 *
 * Each check reads as a line of code with the value the shown response
 * gave it: its type, the value, and a gauge against the threshold of a
 * numeric comparison. Selecting a line edits it; a new blank row opens in
 * edit mode. Below the checks sit the snapshot check, checks suggested by
 * the response, and the variables the request resolves.
 */

import { Check, Plus, Trash2, X } from 'lucide-react';
import { useMemo, useRef, useState, type KeyboardEvent, type LiHTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { HttpVariableScope } from '../../../shared/httpEnvironment';
import { parseJsonBodyOnce } from '../../../shared/httpWorkspaceCaptures';
import type {
  HttpAssertion,
  HttpAssertionComparator,
  HttpAssertionResult,
  HttpAssertionSource,
  HttpResponseV1,
} from '../../../shared/httpWorkspaceSchema';
import { cn } from '../../utils/cn';
import '../../i18n/httpBuilderCatalog';
import { useAnswerContext } from '../Answer/useAnswerContext';
import '../ui/identity.css';
import { containerSummary } from './httpJsonAnswer';
import { isContainer, primitiveText } from './httpJsonTreeModel';
import { JsonLeaf } from './HttpJsonValue';
import { MASKED_VALUE, SCOPE_TINTS, tintPill, UNRESOLVED_TINT } from './httpScopeColors';
import { answerAssertion, assertionExpression, isIncomplete, usesExpected, usesPath, type AssertionAnswer } from './httpTestLines';

/** A variable the request references, as the active scopes resolve it. */
export interface HttpTestVariable {
  readonly key: string;
  readonly scope?: HttpVariableScope;
  /** The scope as shown: the environment's name, or the scope's label. */
  readonly scopeLabel: string;
  readonly state: 'resolved' | 'secret' | 'unresolved';
  /** The effective value; absent for secrets and unresolved names. */
  readonly value?: string;
}

export interface HttpAssertionsTabProps {
  assertions: ReadonlyArray<HttpAssertion>;
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<HttpAssertion>) => void;
  onRemove: (index: number) => void;
  /** The response shown in the preview; its values answer each line. */
  response?: HttpResponseV1;
  /** Results of the enabled checks against `response`, by assertion id. */
  results?: ReadonlyMap<string, HttpAssertionResult>;
  /** Changes against the stored snapshot, when the request keeps one. */
  snapshotChanges?: number;
  suggestions?: ReadonlyArray<Omit<HttpAssertion, 'id'>>;
  onAddSuggestion?: (assertion: Omit<HttpAssertion, 'id'>) => void;
  variables?: ReadonlyArray<HttpTestVariable>;
}

/** What the shown response answers in the tab, beside the rows and their handlers. */
export type HttpTestAnswers = Omit<HttpAssertionsTabProps, 'assertions' | 'onAdd' | 'onUpdate' | 'onRemove'>;

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

const plain = (text: string) => text;

function ResultGlyph({ pass }: { readonly pass: boolean | undefined }) {
  if (pass === undefined) return <span className="mx-auto h-1.5 w-1.5 rounded-full bg-fg-subtle/60" aria-hidden="true" />;
  return pass ? (
    <Check size={13} className="mx-auto text-success-fg" aria-hidden="true" />
  ) : (
    <X size={13} className="mx-auto text-error-fg" aria-hidden="true" />
  );
}

interface TestLineProps extends Omit<LiHTMLAttributes<HTMLLIElement>, 'children'> {
  readonly glyph?: ReactNode;
  readonly code: ReactNode;
  readonly answer?: ReactNode;
  readonly action?: ReactNode;
}

/** One line of the tab's grid: result, code, leader, answer, action; missing cells stay empty. */
function TestLine({ glyph, code, answer, action, className, ...rest }: TestLineProps) {
  return (
    <li className={cn('http-test-line', className)} {...rest}>
      {glyph ?? <span />}
      {code}
      <span className="dot-leader http-test-leader" aria-hidden="true" />
      {answer ?? <span className="http-test-answer" />}
      {action ?? <span />}
    </li>
  );
}

export function HttpAssertionsTab({
  assertions,
  onAdd,
  onUpdate,
  onRemove,
  response,
  results,
  snapshotChanges,
  suggestions,
  onAddSuggestion,
  variables,
}: HttpAssertionsTabProps) {
  const { t } = useTranslation();
  const context = useAnswerContext();
  const body = useMemo(() => (response ? parseJsonBodyOnce(response) : null), [response]);
  const canSuggest = suggestions !== undefined && suggestions.length > 0 && onAddSuggestion !== undefined;

  // Rows open for editing: blank ones on mount, and blank ones added later.
  const [known, setKnown] = useState<ReadonlySet<string>>(() => new Set(assertions.map((row) => row.id)));
  const [editing, setEditing] = useState<ReadonlySet<string>>(() => new Set(assertions.filter(isIncomplete).map((row) => row.id)));
  const fresh = assertions.filter((row) => !known.has(row.id));
  if (fresh.length > 0) {
    setKnown(new Set(assertions.map((row) => row.id)));
    const blank = fresh.filter(isIncomplete);
    if (blank.length > 0) setEditing((current) => new Set([...current, ...blank.map((row) => row.id)]));
  }
  // The row whose first control takes focus once it renders: the form on open, the line on close.
  const focusRef = useRef<string | null>(null);
  const takeFocus = (id: string) => (element: HTMLElement | null) => {
    if (element && focusRef.current === id) {
      focusRef.current = null;
      element.focus();
    }
  };
  const setEdit = (id: string, open: boolean) => {
    focusRef.current = id;
    setEditing((current) => {
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const renderAnswer = (answer: AssertionAnswer, pass: boolean) => (
    <span className="http-test-answer" data-testid="http-test-answer">
      <span className="type-tag">{answer.tag}</span>
      {answer.value === undefined ? (
        <span className="answer-object-value" data-tone={pass ? 'none' : 'error'} data-pill="">
          {t('httpWorkspace.editor.assert.results.miss')}
        </span>
      ) : isContainer(answer.value) ? (
        <span className="json-table-nested">{containerSummary(answer.value)}</span>
      ) : (
        <JsonLeaf value={answer.value} text={primitiveText(answer.value)} context={context} highlight={plain} pill="all" />
      )}
      {answer.gauge ? (
        <span className="answer-object-gauge" aria-hidden="true" data-testid="http-test-gauge">
          <i style={{ width: `${Math.min(answer.gauge.fill, answer.gauge.mark)}%` }} />
          {answer.gauge.fill > answer.gauge.mark ? (
            <i data-over="" style={{ left: `${answer.gauge.mark}%`, width: `${answer.gauge.fill - answer.gauge.mark}%` }} />
          ) : null}
          <b style={{ left: `${answer.gauge.mark}%` }} />
        </span>
      ) : null}
    </span>
  );

  const editKeys = (id: string) => (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    setEdit(id, false);
  };

  return (
    <section data-testid="http-request-editor-assert" className="http-tests-frame answer-scope pt-1">
      <div className="http-tests gap-y-0.5">
      {assertions.length === 0 ? (
        <p data-testid="http-request-editor-assert-empty" className="px-1 pb-1 text-caption text-fg-subtle">
          {t('httpWorkspace.editor.assert.empty')}
        </p>
      ) : null}
      <ul role="list" className="gap-y-0.5">
        {assertions.map((assertion, i) => {
          const result = results?.get(assertion.id);
          const pass = result?.pass;
          if (editing.has(assertion.id)) {
            return (
              <li key={assertion.id} data-testid="http-test-edit" onKeyDown={editKeys(assertion.id)} className="flex min-w-0 items-start gap-1.5 rounded-md bg-bg-inset/50 p-1.5">
                <input
                  type="checkbox"
                  checked={assertion.enabled}
                  onChange={(event) => onUpdate(i, { enabled: event.target.checked })}
                  data-testid="http-request-editor-assert-enabled"
                  className="mt-1.5 shrink-0"
                  aria-label={t('httpWorkspace.editor.assert.enabledAria', { index: i + 1 })}
                />
                <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
                  <select
                    ref={takeFocus(assertion.id)}
                    value={assertion.source}
                    onChange={(event) => onUpdate(i, { source: event.target.value as HttpAssertionSource })}
                    data-testid="http-request-editor-assert-source"
                    aria-label={t('httpWorkspace.editor.assert.sourceAria', { index: i + 1 })}
                    className="h-7 min-w-0 rounded-md border border-border-subtle bg-bg-inset px-1.5 text-caption text-fg-base focus:border-border-strong focus:outline-none"
                  >
                    {ASSERTION_SOURCES.map((source) => (
                      <option key={source.id} value={source.id}>
                        {t(source.labelKey)}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={assertion.path}
                    onChange={(event) => onUpdate(i, { path: event.target.value })}
                    disabled={!usesPath(assertion.source)}
                    placeholder={t(
                      assertion.source === 'header'
                        ? 'httpWorkspace.editor.assert.path.headerPlaceholder'
                        : 'httpWorkspace.editor.assert.path.jsonPlaceholder'
                    )}
                    aria-label={t('httpWorkspace.editor.assert.pathAria', { index: i + 1 })}
                    data-testid="http-request-editor-assert-path"
                    className="h-7 min-w-0 rounded-md border border-border-subtle bg-bg-inset px-2 font-mono text-caption text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                  />
                  <select
                    value={assertion.comparator}
                    onChange={(event) => onUpdate(i, { comparator: event.target.value as HttpAssertionComparator })}
                    data-testid="http-request-editor-assert-comparator"
                    aria-label={t('httpWorkspace.editor.assert.comparatorAria', { index: i + 1 })}
                    className="h-7 min-w-0 rounded-md border border-border-subtle bg-bg-inset px-1.5 text-caption text-fg-base focus:border-border-strong focus:outline-none"
                  >
                    {ASSERTION_COMPARATORS.map((cmp) => (
                      <option key={cmp.id} value={cmp.id}>
                        {t(cmp.labelKey)}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={assertion.expected}
                    onChange={(event) => onUpdate(i, { expected: event.target.value })}
                    disabled={!usesExpected(assertion.comparator)}
                    placeholder={t('httpWorkspace.editor.assert.expected.placeholder')}
                    aria-label={t('httpWorkspace.editor.assert.expectedAria', { index: i + 1 })}
                    data-testid="http-request-editor-assert-expected"
                    className="h-7 min-w-0 rounded-md border border-border-subtle bg-bg-inset px-2 font-mono text-caption text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </div>
                <div className="flex shrink-0 flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => setEdit(assertion.id, false)}
                    data-testid="http-request-editor-assert-done"
                    aria-label={t('httpWorkspace.editor.assert.doneAria', { index: i + 1 })}
                    title={t('httpWorkspace.editor.assert.doneAria', { index: i + 1 })}
                    className="focus-ring inline-flex h-6 w-6 items-center justify-center rounded text-fg-subtle transition-colors hover:text-fg-base"
                  >
                    <Check size={12} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(i)}
                    aria-label={t('httpWorkspace.editor.assert.remove.aria', { index: i + 1 })}
                    className="focus-ring inline-flex h-6 w-6 items-center justify-center rounded text-fg-subtle transition-colors hover:text-error-fg"
                  >
                    <Trash2 size={11} aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          }
          const expression = assertionExpression(assertion);
          const answer = response && result ? answerAssertion(response, body, assertion, result) : null;
          return (
            <TestLine
              key={assertion.id}
              data-testid="http-test-line"
              data-enabled={assertion.enabled}
              {...(pass === undefined ? {} : { 'data-pass': pass })}
              className="group"
              glyph={<ResultGlyph pass={pass} />}
              code={
                <button
                  ref={takeFocus(assertion.id)}
                  type="button"
                  onClick={() => setEdit(assertion.id, true)}
                  data-testid="http-test-line-edit"
                  aria-label={t('httpWorkspace.editor.assert.editAria', { index: i + 1, expression })}
                  title={expression}
                  className="http-test-code focus-ring rounded-sm"
                >
                  {expression}
                </button>
              }
              {...(answer ? { answer: renderAnswer(answer, pass ?? false) } : {})}
              action={
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  aria-label={t('httpWorkspace.editor.assert.remove.aria', { index: i + 1 })}
                  className="focus-ring inline-flex h-6 w-6 items-center justify-center rounded text-fg-subtle opacity-0 transition-colors hover:text-error-fg focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 size={11} aria-hidden="true" />
                </button>
              }
            />
          );
        })}
        {snapshotChanges !== undefined ? (
          <TestLine
            data-testid="http-response-snapshot-row"
            data-pass={snapshotChanges === 0}
            glyph={<ResultGlyph pass={snapshotChanges === 0} />}
            code={<span className="http-test-code">{t('httpWorkspace.editor.assert.snapshotLine')}</span>}
            answer={
              <span className="http-test-answer">
                <span className="type-tag">{t('httpWorkspace.response.tab.snapshot')}</span>
                <span className="answer-object-value" data-tone={snapshotChanges === 0 ? 'number' : 'error'} data-pill="">
                  {t('httpWorkspace.snapshot.changes', { count: snapshotChanges })}
                </span>
              </span>
            }
          />
        ) : null}
        <TestLine
          data-testid="http-test-add-line"
          data-suggestions={canSuggest ? '' : undefined}
          glyph={<Plus size={12} className="mx-auto text-fg-subtle" aria-hidden="true" />}
          code={
            <button type="button" onClick={onAdd} data-testid="http-request-editor-assert-add" className="http-test-code focus-ring rounded-sm" data-muted="">
              {t('httpWorkspace.editor.assert.add')}
            </button>
          }
          {...(canSuggest
            ? {
                answer: (
                  <span className="http-test-answer http-test-suggestions" data-testid="http-response-suggestions">
                    <span className="type-tag">{t('httpWorkspace.snapshot.suggested')}</span>
                    <span className="http-test-chips">
                      {suggestions.map((suggestion) => {
                        const label = assertionExpression(suggestion);
                        return (
                          <button
                            key={`${suggestion.source}:${suggestion.path}:${suggestion.comparator}`}
                            type="button"
                            data-testid="http-response-suggestion"
                            onClick={() => onAddSuggestion(suggestion)}
                            aria-label={t('httpWorkspace.editor.assert.addSuggestion', { expression: label })}
                            title={label}
                            className="http-test-chip focus-ring"
                          >
                            {label}
                          </button>
                        );
                      })}
                    </span>
                  </span>
                ),
              }
            : {})}
        />
      </ul>
      {variables && variables.length > 0 ? (
        <ul role="list" aria-label={t('httpWorkspace.editor.assert.variablesAria')} className="mt-2 gap-y-0.5" data-testid="http-test-variables">
          {variables.map((variable) => (
            <TestLine
              key={variable.key}
              data-testid="http-test-variable"
              data-state={variable.state}
              code={
                <span className="http-test-code">
                  <span className="rounded-sm px-0.5" style={tintPill(variable.scope ? SCOPE_TINTS[variable.scope] : UNRESOLVED_TINT)}>{`{{${variable.key}}}`}</span>
                </span>
              }
              answer={
                <span className="http-test-answer">
                  <span className="type-tag" title={variable.scopeLabel}>{variable.scopeLabel}</span>
                  {variable.state === 'resolved' && variable.value !== undefined ? (
                    <span className="answer-object-value" data-tone="string" title={variable.value} data-testid="http-test-variable-value">
                      {JSON.stringify(variable.value)}
                    </span>
                  ) : (
                    <span className="answer-object-value" data-tone={variable.state === 'unresolved' ? 'error' : 'none'} data-pill="" data-testid="http-test-variable-value">
                      {variable.state === 'secret' ? MASKED_VALUE : t('httpWorkspace.environment.preview.unresolvedBadge')}
                    </span>
                  )}
                </span>
              }
            />
          ))}
        </ul>
      ) : null}
      </div>
    </section>
  );
}
