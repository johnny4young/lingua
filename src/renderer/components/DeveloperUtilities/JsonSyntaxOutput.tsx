import type { Monaco } from '@monaco-editor/react';
import { useEffect, useId, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { inspectTimestampLike, type TimestampHoverInfo } from '../../utils/developerUtilities';
import { cn } from '../../utils/cn';
import { defineCustomThemes, getEditorThemeSurface } from '../Editor/editorThemes';

interface JsonTimestampRange {
  start: number;
  end: number;
  timestamp: TimestampHoverInfo;
}

let jsonTokenizerReady: Promise<void> | null = null;

export interface JsonSyntaxOutputProps {
  value: string;
  ariaLabel: string;
  testid?: string;
  className?: string;
}

/**
 * Read-only JSON output with Monaco token colors, the active editor font and
 * background, and timestamp inspection for object-property values. It keeps
 * text selectable and intentionally owns no Monaco editor model, cursor, or
 * keyboard shortcuts.
 */
export function JsonSyntaxOutput({ value, ariaLabel, testid, className }: JsonSyntaxOutputProps) {
  const { t } = useTranslation();
  const editorTheme = useSettingsStore(state => state.editorTheme);
  const fontFamily = useSettingsStore(state => state.fontFamily);
  const fontSize = useSettingsStore(state => state.fontSize);
  const hostRef = useRef<HTMLPreElement | null>(null);
  const outputId = useId().replace(/:/g, '');
  const timestamps = useMemo(() => findTimestampRanges(value), [value]);
  const surface = getEditorThemeSurface(editorTheme);
  const localLabel = t('utilities.timestampHover.local');
  const utcLabel = t('utilities.timestampHover.utc');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // React never owns the `<pre>` contents: Monaco writes its token spans
    // after this safe text assignment, avoiding an HTML-string injection path.
    host.textContent = value;
    let cancelled = false;
    const decorateTimestamps = () => {
      if (!cancelled && hostRef.current) {
        addTimestampTooltips(hostRef.current, timestamps, {
          idPrefix: outputId,
          localLabel,
          utcLabel,
        });
      }
    };

    // Monaco's static highlighter relies on CSS.escape internally. All
    // supported app browsers provide it; the guard keeps non-browser test
    // environments and unusual embedded shells on a readable plain-text path.
    const cssEscapeAvailable = typeof globalThis.CSS?.escape === 'function';
    if (!cssEscapeAvailable || value.length === 0) {
      decorateTimestamps();
      return () => {
        cancelled = true;
      };
    }

    // Do not make the first utility paint wait for Monaco. The dynamic import
    // keeps the utilities panel cheap until a JSON output is actually visible;
    // its plain-text content remains readable while the editor chunk arrives.
    void import('../../monaco')
      .then(({ getConfiguredMonaco }) => {
        if (cancelled || !hostRef.current) return;
        const monaco = getConfiguredMonaco();
        if (typeof monaco.editor.colorizeElement !== 'function') {
          decorateTimestamps();
          return;
        }
        defineCustomThemes(monaco);
        return ensureJsonTokenizer(monaco)
          .then(() => {
            const currentHost = hostRef.current;
            if (cancelled || !currentHost) return;
            // Colorize a detached element, then move its safe DOM nodes into
            // the live output only if this effect is still current. Monaco's
            // colorizer is async; this avoids a late older result overwriting
            // freshly entered JSON in the visible panel.
            const colorizedOutput = document.createElement('pre');
            colorizedOutput.textContent = value;
            return monaco.editor
              .colorizeElement(colorizedOutput, {
                // Monaco resolves this option as a MIME type rather than a
                // language id. `application/json` selects the JSON tokenizer;
                // passing `json` falls back to plain-text token colors.
                mimeType: 'application/json',
                theme: editorTheme,
                tabSize: 2,
              })
              .then(() => {
                if (cancelled || hostRef.current !== currentHost) return;
                currentHost.replaceChildren(...Array.from(colorizedOutput.childNodes));
              });
          })
          .then(decorateTimestamps)
          .catch(decorateTimestamps);
      })
      .catch(decorateTimestamps);

    return () => {
      cancelled = true;
    };
  }, [editorTheme, localLabel, outputId, timestamps, utcLabel, value]);

  return (
    <pre
      ref={hostRef}
      role="region"
      aria-label={ariaLabel}
      data-testid={testid}
      data-editor-theme={editorTheme}
      className={cn(
        'm-0 max-h-[22rem] overflow-auto rounded-2xl border border-border/80 p-3 whitespace-pre font-mono text-body-sm leading-6',
        className
      )}
      style={{
        backgroundColor: surface.background,
        color: surface.foreground,
        fontFamily,
        fontSize,
      }}
    />
  );
}

function ensureJsonTokenizer(monaco: Monaco): Promise<void> {
  if (jsonTokenizerReady) return jsonTokenizerReady;

  // JSON's Monaco contribution registers its tokenizer through an
  // `onLanguage('json')` callback. A static colorizer alone does not activate
  // that callback, so prime it once with a throwaway model then dispose the
  // model immediately. Subsequent output updates only reuse the tokenizer.
  const model = monaco.editor.createModel('', 'json');
  const ready = monaco.editor
    .colorize('', 'json')
    .then(() => undefined)
    .catch((error: unknown) => {
      jsonTokenizerReady = null;
      throw error;
    })
    .finally(() => model.dispose());
  jsonTokenizerReady = ready;
  return ready;
}

function findTimestampRanges(value: string): JsonTimestampRange[] {
  const ranges: JsonTimestampRange[] = [];
  // JSON.stringify emits quoted object keys and JSON number literals. Matching
  // only direct object-property values means quoted values and array indexes
  // cannot be mistaken for timestamp claims.
  const propertyNumber =
    /"((?:\\.|[^"\\])*)"\s*:\s*(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/gu;

  for (const match of value.matchAll(propertyNumber)) {
    const encodedLabel = match[1];
    const number = match[2];
    if (encodedLabel === undefined || number === undefined || match.index === undefined) continue;

    let label: string;
    try {
      label = JSON.parse(`"${encodedLabel}"`) as string;
    } catch {
      continue;
    }
    const timestamp = inspectTimestampLike(number, label);
    if (!timestamp) continue;

    const numberOffset = match[0].lastIndexOf(number);
    if (numberOffset < 0) continue;
    const start = match.index + numberOffset;
    ranges.push({ start, end: start + number.length, timestamp });
  }

  return ranges;
}

function addTimestampTooltips(
  host: HTMLElement,
  timestamps: readonly JsonTimestampRange[],
  labels: { idPrefix: string; localLabel: string; utcLabel: string }
) {
  // Work from the end so the inserted tooltip text never shifts the source
  // offsets for a timestamp that appears earlier in the JSON document.
  for (let index = timestamps.length - 1; index >= 0; index -= 1) {
    const range = timestamps[index];
    if (!range) continue;
    const sourceRange = rangeForTextOffsets(host, range.start, range.end);
    if (!sourceRange) continue;

    const wrapper = document.createElement('span');
    wrapper.className = 'group relative inline-flex align-baseline';
    const tooltipId = `utility-json-timestamp-${labels.idPrefix}-${index}`;

    const trigger = document.createElement('span');
    trigger.tabIndex = 0;
    trigger.setAttribute('aria-describedby', tooltipId);
    trigger.setAttribute('data-testid', 'json-timestamp-value');
    trigger.className =
      'focus-ring inline-flex cursor-help rounded-md border border-accent/25 bg-accent/10 px-1 py-0.5 font-semibold text-inherit transition-colors hover:border-accent/45 hover:bg-accent/15';
    trigger.append(sourceRange.extractContents());
    wrapper.append(trigger);

    const tooltip = document.createElement('span');
    tooltip.id = tooltipId;
    tooltip.setAttribute('role', 'tooltip');
    tooltip.className =
      'pointer-events-none absolute left-0 top-[calc(100%+0.45rem)] z-50 hidden w-max max-w-[20rem] rounded-xl border border-border-subtle bg-bg-panel px-3 py-2 text-left text-caption leading-5 text-fg-base shadow-xl group-hover:block group-focus-within:block';
    appendTooltipLine(
      tooltip,
      labels.localLabel,
      'font-mono text-[0.68rem] font-bold uppercase tracking-[0.18em] text-fg-subtle'
    );
    appendTooltipLine(tooltip, range.timestamp.local, 'block whitespace-nowrap');
    appendTooltipLine(
      tooltip,
      labels.utcLabel,
      'mt-1.5 font-mono text-[0.68rem] font-bold uppercase tracking-[0.18em] text-fg-subtle'
    );
    appendTooltipLine(tooltip, range.timestamp.utc, 'block whitespace-nowrap');
    appendTooltipLine(
      tooltip,
      range.timestamp.iso,
      'mt-1.5 font-mono text-[0.68rem] text-fg-muted'
    );
    wrapper.append(tooltip);
    sourceRange.insertNode(wrapper);
  }
}

function appendTooltipLine(parent: HTMLElement, text: string, className: string) {
  const line = document.createElement('span');
  line.className = `block ${className}`;
  line.textContent = text;
  parent.append(line);
}

function rangeForTextOffsets(host: HTMLElement, start: number, end: number): Range | null {
  // `colorizeElement()` turns source newlines into `<br>` elements. Treat each
  // one as its original one-character newline while mapping source offsets, or
  // every later line will wrap the wrong token.
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE || node.nodeName === 'BR') {
        return NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_SKIP;
    },
  });
  let node: Node | null;
  let offset = 0;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let startOffset = 0;
  let endOffset = 0;
  while ((node = walker.nextNode())) {
    if (node.nodeName === 'BR') {
      offset += 1;
      continue;
    }

    const textNode = node as Text;
    const nextOffset = offset + textNode.data.length;
    if (!startNode && start >= offset && start <= nextOffset) {
      startNode = textNode;
      startOffset = start - offset;
    }
    if (!endNode && end >= offset && end <= nextOffset) {
      endNode = textNode;
      endOffset = end - offset;
    }
    if (startNode && endNode) break;
    offset = nextOffset;
  }

  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}
