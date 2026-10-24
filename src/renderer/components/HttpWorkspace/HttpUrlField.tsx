import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { splitVariableTokens, type HttpEnvironmentV1, type HttpUrlState } from '../../../shared/httpEnvironment';
import type { HttpTransportKind } from '../../../shared/httpWorkspaceSchema';
import { cn } from '../../utils/cn';

export const URL_HINT_ID = 'http-request-editor-url-hint';

/** Why Send is off, under the URL row. */
export function HttpUrlHint({
  state,
  transport,
  hasEnvironment,
}: {
  state: Exclude<HttpUrlState, { ok: true }>;
  transport: HttpTransportKind;
  hasEnvironment: boolean;
}) {
  const { t } = useTranslation();
  const text =
    state.reason === 'empty'
      ? t('httpWorkspace.editor.url.hint.empty')
      : state.reason === 'unresolved'
        ? t(hasEnvironment ? 'httpWorkspace.editor.url.hint.unresolved' : 'httpWorkspace.editor.url.hint.unresolvedNoEnv', { name: state.key })
        : t(transport === 'websocket' ? 'httpWorkspace.editor.url.hint.invalidWebsocket' : 'httpWorkspace.editor.url.hint.invalid');
  return (
    <p id={URL_HINT_ID} data-testid="http-request-editor-url-hint" className="-mt-1 shrink-0 text-caption text-fg-subtle">
      {text}
    </p>
  );
}

export interface HttpUrlFieldProps {
  value: string;
  env: HttpEnvironmentV1 | null;
  placeholder: string;
  ariaLabel: string;
  describedBy?: string;
  onChange: (value: string) => void;
  onPaste: (event: React.ClipboardEvent<HTMLInputElement>) => void;
}

// Both layers share font, size and padding, and tokens only change colour, so every glyph lines up.
const TEXT = 'px-3 font-mono text-body-sm';

/**
 * The URL input. With `{{tokens}}` in it, the text is drawn by a layer behind
 * a transparent input, which keeps native editing and highlights each token:
 * accent when the environment defines it, red when it does not.
 */
export function HttpUrlField({ value, env, placeholder, ariaLabel, describedBy, onChange, onPaste }: HttpUrlFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const pieces = useMemo(() => splitVariableTokens(value), [value]);
  const mirrored = pieces.some((piece) => piece.key !== undefined);
  const known = useMemo(() => new Set(env?.variables.map((variable) => variable.key) ?? []), [env]);

  const syncScroll = useCallback(() => {
    if (inputRef.current && mirrorRef.current) mirrorRef.current.scrollLeft = inputRef.current.scrollLeft;
  }, []);
  useLayoutEffect(syncScroll, [syncScroll, value]);
  // Resizing the field can move the input's scroll position without a scroll event.
  useEffect(() => {
    const input = inputRef.current;
    if (!mirrored || !input || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(syncScroll);
    observer.observe(input);
    return () => observer.disconnect();
  }, [mirrored, syncScroll]);

  return (
    <div
      data-testid="http-request-editor-url-field"
      data-mirrored={mirrored}
      className="relative h-8 min-w-0 flex-1 rounded-md border border-border-subtle bg-bg-inset focus-within:border-border-strong"
    >
      {mirrored ? (
        <div
          ref={mirrorRef}
          aria-hidden="true"
          data-testid="http-request-editor-url-mirror"
          className={cn(TEXT, 'pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre text-fg-base')}
        >
          {pieces.map((piece, index) =>
            piece.key === undefined ? (
              <span key={index}>{piece.text}</span>
            ) : (
              <span
                key={index}
                data-testid="http-request-editor-url-token"
                data-state={known.has(piece.key) ? 'defined' : 'missing'}
                className={cn('rounded-sm', known.has(piece.key) ? 'bg-accent-tint text-accent-fg' : 'bg-error-bg text-error-fg')}
              >
                {piece.text}
              </span>
            )
          )}
          {/* Lets the layer scroll as far as the input when the caret sits at the end. */}
          <span> </span>
        </div>
      ) : null}
      <input
        ref={inputRef}
        type="text"
        data-testid="http-request-editor-url"
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onPaste={onPaste}
        onScroll={syncScroll}
        onSelect={syncScroll}
        onKeyUp={syncScroll}
        className={cn(
          TEXT,
          'absolute inset-0 h-full w-full rounded-md bg-transparent placeholder:italic placeholder:text-fg-subtle focus:outline-none',
          mirrored ? 'text-transparent caret-fg-base selection:bg-accent/30' : 'text-fg-base'
        )}
      />
    </div>
  );
}
