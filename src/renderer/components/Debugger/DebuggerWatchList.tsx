import { useRef, useState, type FormEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import '../../i18n/debuggerCatalog';
import {
  type DebuggerRuntime,
  MAX_WATCHES,
  MAX_WATCH_EXPRESSION_LENGTH,
  comparablePreviousPause,
  useDebuggerStore,
} from '../../stores/debuggerStore';
import { AnswerObject } from '../Answer/AnswerObject';
import { AnswerWasChip } from '../Answer/AnswerDeltaChip';
import { DrawerColumn } from './DrawerColumn';

export function DebuggerWatchList({
  runtime = null,
  language,
}: {
  runtime?: DebuggerRuntime | null;
  language?: string;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const watches = useDebuggerStore(state => state.watches);
  const pausedFrame = useDebuggerStore(state => state.pausedFrame);
  const previous = useDebuggerStore(state => comparablePreviousPause(state)?.watches);
  const addWatch = useDebuggerStore(state => state.addWatch);
  const removeWatch = useDebuggerStore(state => state.removeWatch);
  const atLimit = watches.length >= MAX_WATCHES;
  const native = runtime === 'python' || runtime === 'go' || runtime === 'rust';

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const expression = draft.trim();
    if (!expression || atLimit) return;
    addWatch(expression);
    setDraft('');
  };

  return (
    <DrawerColumn
      testid="debugger-watches"
      className="debugger-column--watch"
      title={t('debugger.paused.watches')}
      aside={
        <button
          type="button"
          className="icon-button debugger-column-action"
          data-testid="debugger-watch-focus"
          aria-label={t('debugger.watches.input')}
          title={t('debugger.watches.input')}
          disabled={atLimit}
          onClick={() => inputRef.current?.focus()}
        >
          <Plus size={13} aria-hidden="true" />
        </button>
      }
    >
      <ul className="debugger-rows">
        {watches.map(watch => {
          const result = pausedFrame?.watchResults[watch.expression];
          const before = previous?.[watch.expression];
          const changed = result?.value !== undefined && before !== undefined && before !== result.value;
          return (
            <li
              key={watch.id}
              data-testid={`debugger-watch-${watch.id}`}
              data-change={changed ? 'changed' : undefined}
              className="debugger-row debugger-watch"
            >
              <span className="debugger-watch-expression" title={watch.expression}>
                {watch.expression}
              </span>
              <span className="debugger-row-value debugger-watch-value">
                {!pausedFrame ? (
                  <span className="debugger-muted">{t('debugger.watches.nextPause')}</span>
                ) : result?.error ? (
                  <span className="debugger-error">{t('debugger.watches.error', { message: result.error })}</span>
                ) : result?.value !== undefined ? (
                  <AnswerObject text={result.value} role="value" language={language} compact hideTag />
                ) : (
                  <span className="debugger-muted">—</span>
                )}
              </span>
              {changed ? <AnswerWasChip value={before} /> : null}
              <button
                type="button"
                onClick={() => removeWatch(watch.id)}
                aria-label={t('debugger.watches.remove', { expression: watch.expression })}
                className="icon-button debugger-row-remove"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      <form className="debugger-watch-form" onSubmit={submit}>
        <input
          ref={inputRef}
          value={draft}
          onChange={event => setDraft(event.currentTarget.value)}
          maxLength={MAX_WATCH_EXPRESSION_LENGTH}
          disabled={atLimit}
          placeholder={t('debugger.watches.placeholder')}
          aria-label={t('debugger.watches.input')}
          title={native ? undefined : t('debugger.watches.safeExpressionHint')}
          data-testid="debugger-watch-input"
          className="debugger-watch-input"
        />
        {draft.trim() ? (
          <button type="submit" data-testid="debugger-watch-add" className="debugger-link">
            {t('debugger.watches.add')}
          </button>
        ) : null}
      </form>
      {atLimit ? (
        <p className="debugger-footnote">{t('debugger.watches.limit', { count: MAX_WATCHES })}</p>
      ) : native ? (
        <p className="debugger-footnote">{t('debugger.watches.nativeExpressionHint')}</p>
      ) : null}
    </DrawerColumn>
  );
}
