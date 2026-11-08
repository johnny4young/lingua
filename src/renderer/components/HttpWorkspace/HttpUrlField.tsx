import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  splitVariableTokens,
  type HttpUrlState,
  type HttpVariableSource,
} from '../../../shared/httpEnvironment';
import { requestLabel, type HttpChainTag } from '../../../shared/httpChain';
import type { HttpTransportKind } from '../../../shared/httpWorkspaceSchema';
import { useWorkspaceToolStore } from '../../stores/workspaceToolStore';
import { cn } from '../../utils/cn';
import '../../i18n/httpBuilderCatalog';
import { SCOPE_TINTS, tintPill, UNRESOLVED_TINT } from './httpScopeColors';

export const URL_HINT_ID = 'http-request-editor-url-hint';

/** Why Send is off, under the URL row. */
export function HttpUrlHint({
  state,
  transport,
  hasEnvironment,
  fix,
  chainSource,
}: {
  state: Exclude<HttpUrlState, { ok: true }>;
  transport: HttpTransportKind;
  hasEnvironment: boolean;
  /** The missing variable is a chain tag whose source has no 2xx response yet. */
  chainSource?: string;
  /** Another environment defines what is missing: one click copies it into the active one. */
  fix?: { envName: string; onAdd: () => void };
}) {
  const { t } = useTranslation();
  const text =
    state.reason === 'empty'
      ? t('httpWorkspace.editor.url.hint.empty')
      : state.reason === 'unresolved' && chainSource !== undefined
        ? t('httpWorkspace.editor.url.hint.chain', { name: state.key, source: chainSource })
        : state.reason === 'unresolved'
        ? t(hasEnvironment ? 'httpWorkspace.editor.url.hint.unresolved' : 'httpWorkspace.editor.url.hint.unresolvedNoEnv', { name: state.key })
        : t(transport === 'websocket' ? 'httpWorkspace.editor.url.hint.invalidWebsocket' : 'httpWorkspace.editor.url.hint.invalid');
  return (
    <p id={URL_HINT_ID} data-testid="http-request-editor-url-hint" className="-mt-1 shrink-0 text-caption text-fg-subtle">
      {text}
      {fix ? (
        <button
          type="button"
          data-testid="http-request-editor-url-hint-add"
          onClick={fix.onAdd}
          className="focus-ring ml-2 rounded-sm font-medium text-accent-fg underline-offset-2 hover:underline"
        >
          {t('httpWorkspace.environment.unresolved.addTo', { env: fix.envName })}
        </button>
      ) : null}
    </p>
  );
}

export interface HttpUrlFieldProps {
  value: string;
  /** Each token takes the colour of the scope that resolves it. */
  sources: ReadonlyMap<string, HttpVariableSource>;
  placeholder: string;
  ariaLabel: string;
  describedBy?: string;
  onChange: (value: string) => void;
  onPaste: (event: React.ClipboardEvent<HTMLInputElement>) => void;
  /** Chain tags the URL uses: away from the field each reads as its source and path, and opens on click. */
  chain?: { tags: readonly HttpChainTag[]; openTag: string | null; onOpenTag: (key: string | null) => void };
}

/** `response(List repos) · $[0].owner.login`: where a chain tag's value comes from. */
function tagLabel(tag: HttpChainTag): string {
  const source = useWorkspaceToolStore.getState().getRequest(tag.sourceId);
  const path = tag.capture.source === 'status' ? 'status' : tag.capture.path;
  return `response(${source ? requestLabel(source) : tag.sourceId}) · ${path}`;
}

// Both layers share font, size and padding, and tokens only change colour, so every glyph lines up.
const TEXT = 'px-3 font-mono text-body-sm';

/**
 * The URL input. With `{{tokens}}` in it, the text is drawn by a layer behind
 * a transparent input, which keeps native editing and colours each token by
 * the scope that resolves it, red when none does.
 */
export function HttpUrlField({ value, sources, placeholder, ariaLabel, describedBy, onChange, onPaste, chain }: HttpUrlFieldProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const pieces = useMemo(() => splitVariableTokens(value), [value]);
  const mirrored = pieces.some((piece) => piece.key !== undefined);
  const tags = useMemo(() => new Map(chain?.tags.map((tag) => [tag.key, tag])), [chain?.tags]);
  // Labels are wider than their `{{token}}`, so they show only while the caret is elsewhere.
  const labelled = !focused && pieces.some((piece) => piece.key !== undefined && tags.has(piece.key));

  const syncScroll = useCallback(() => {
    if (inputRef.current && mirrorRef.current) mirrorRef.current.scrollLeft = labelled ? 0 : inputRef.current.scrollLeft;
  }, [labelled]);
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
      className="relative h-8 min-w-[7rem] flex-1 rounded-md border border-border-subtle bg-bg-inset focus-within:border-border-strong"
    >
      {mirrored ? (
        <div
          ref={mirrorRef}
          aria-hidden="true"
          data-testid="http-request-editor-url-mirror"
          className={cn(TEXT, 'pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre text-fg-base', labelled && 'z-10')}
        >
          {pieces.map((piece, index) => {
            // Away from the field the tag keeps its width and the plain text gives way.
            if (piece.key === undefined) return <span key={index} className={labelled ? 'min-w-0 truncate' : undefined}>{piece.text}</span>;
            const tag = labelled ? tags.get(piece.key) : undefined;
            if (tag && chain) {
              const label = tagLabel(tag);
              return (
                <button
                  key={index}
                  type="button"
                  tabIndex={-1}
                  data-testid="http-request-editor-url-tag"
                  data-tag={tag.key}
                  aria-pressed={chain.openTag === tag.key}
                  aria-label={t('httpWorkspace.chain.tag.open', { name: tag.key })}
                  title={label}
                  onClick={() => chain.onOpenTag(chain.openTag === tag.key ? null : tag.key)}
                  className="focus-ring pointer-events-auto max-w-[20rem] shrink-0 truncate rounded-sm border px-1 leading-5"
                  style={{ ...tintPill(SCOPE_TINTS.chain), borderColor: SCOPE_TINTS.chain.line }}
                >
                  {label}
                </button>
              );
            }
            const scope = sources.get(piece.key)?.scope;
            return (
              <span
                key={index}
                data-testid="http-request-editor-url-token"
                data-state={scope ?? 'missing'}
                className="rounded-sm"
                style={tintPill(scope ? SCOPE_TINTS[scope] : UNRESOLVED_TINT)}
              >
                {piece.text}
              </span>
            );
          })}
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
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={cn(
          TEXT,
          'absolute inset-0 h-full w-full rounded-md bg-transparent placeholder:italic placeholder:text-fg-subtle focus:outline-none',
          mirrored ? 'text-transparent caret-fg-base selection:bg-accent/30' : 'text-fg-base'
        )}
      />
    </div>
  );
}
