import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  type DebuggerRuntime,
  MAX_WATCHES,
  MAX_WATCH_EXPRESSION_LENGTH,
  useDebuggerStore,
} from '../../stores/debuggerStore';

export function DebuggerWatchList({
  runtime = null,
}: {
  runtime?: DebuggerRuntime | null;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const watches = useDebuggerStore(state => state.watches);
  const pausedFrame = useDebuggerStore(state => state.pausedFrame);
  const addWatch = useDebuggerStore(state => state.addWatch);
  const removeWatch = useDebuggerStore(state => state.removeWatch);
  const atLimit = watches.length >= MAX_WATCHES;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const expression = draft.trim();
    if (!expression || atLimit) return;
    addWatch(expression);
    setDraft('');
  };

  return (
    <div className="grid gap-2">
      <form className="flex gap-2" onSubmit={submit}>
        <input
          value={draft}
          onChange={event => setDraft(event.currentTarget.value)}
          maxLength={MAX_WATCH_EXPRESSION_LENGTH}
          placeholder={t('debugger.watches.placeholder')}
          aria-label={t('debugger.watches.input')}
          data-testid="debugger-watch-input"
          className="field h-8 min-w-0 flex-1 py-1 font-mono text-caption"
        />
        <button
          type="submit"
          disabled={!draft.trim() || atLimit}
          data-testid="debugger-watch-add"
          className="button-secondary inline-flex h-8 shrink-0 items-center gap-1 px-2 text-caption"
        >
          <Plus size={11} aria-hidden="true" />
          {t('debugger.watches.add')}
        </button>
      </form>
      {watches.length === 0 ? (
        <p className="text-caption text-muted">{t('debugger.watches.empty')}</p>
      ) : (
        <ul className="grid max-h-52 gap-1 overflow-auto pr-1">
          {watches.map(watch => {
            const result = pausedFrame?.watchResults[watch.expression];
            return (
              <li
                key={watch.id}
                data-testid={`debugger-watch-${watch.id}`}
                className="flex min-w-0 items-start gap-2 rounded-lg border border-border/70 bg-background/55 px-2 py-1.5"
              >
                <div className="min-w-0 flex-1 font-mono text-caption">
                  <div className="truncate text-foreground" title={watch.expression}>
                    {watch.expression}
                  </div>
                  <div className={result?.error ? 'text-danger' : 'text-muted'}>
                    {!pausedFrame
                      ? t('debugger.watches.nextPause')
                      : result?.error
                        ? t('debugger.watches.error', { message: result.error })
                        : (result?.value ?? '—')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeWatch(watch.id)}
                  aria-label={t('debugger.watches.remove', { expression: watch.expression })}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <Trash2 size={11} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-eyebrow leading-relaxed text-muted">
        {atLimit
          ? t('debugger.watches.limit', { count: MAX_WATCHES })
          : t(
              runtime === 'python'
                ? 'debugger.watches.pythonExpressionHint'
                : 'debugger.watches.safeExpressionHint'
            )}
      </p>
    </div>
  );
}
