import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RichOutputPayload } from '../../../shared/richOutput';
import { OverlayBackdrop, Tooltip } from '../ui/chrome';
import { useEntitlement } from '../../hooks/useEntitlement';
import { pushUpsellNotice } from '../../utils/upsellNotice';
import { writeToClipboard } from '../../utils/clipboard';
import { typeIcon, payloadAsJsonString } from './richConsoleFormat';
import { RichValueError } from './RichValueError';
import { RichValueHtml } from './RichValueHtml';
import { RichValueImage } from './RichValueImage';
import { RichValueChart } from './RichValueChart';

type Tab = 'preview' | 'rawJson';

interface ConsoleEntryPopoverProps {
  payload: RichOutputPayload;
  onClose: () => void;
}

/**
 * RL-044 Slice 1B — detail surface for a single rich console entry.
 * Two tabs:
 *
 *   - **Preview** — a tree-style rendering that exposes the typed
 *     structure (Maps / Sets / Tables / arrays of objects). Slice 1B
 *     keeps the preview deliberately compact — `MAX_SCOPE_DEPTH = 4`
 *     mirrors the `<VariableInspectorPanel>` cap.
 *   - **Raw JSON** — `JSON.stringify(payload)` with a CopyButton.
 *     Pro-gated via `EXECUTION_HISTORY` (fold C); free tier sees an
 *     inline upsell.
 *
 * Tooltip refinement (fold B + user ask): the Raw JSON tab carries
 * the platform-aware `⌘⇧J` keybinding chip + a one-line description.
 * The Preview tab carries the parallel description tooltip without
 * a keybinding (it's the default focus).
 *
 * Focus restoration is delegated to `<OverlayBackdrop>`; closing the
 * popover returns focus to the trigger row.
 */
export function ConsoleEntryPopover({ payload, onClose }: ConsoleEntryPopoverProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('preview');
  const canCopyJson = useEntitlement('EXECUTION_HISTORY');

  // Mod+Shift+J — switch to the Raw JSON tab (fold B). Mod = ⌘ on
  // macOS, Ctrl elsewhere; we accept either modifier so the shortcut
  // works without sniffing `platform`.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() !== 'j') return;
      event.preventDefault();
      setTab((current) => (current === 'rawJson' ? 'preview' : 'rawJson'));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleCopy = useCallback(async () => {
    if (!canCopyJson) {
      pushUpsellNotice({
        messageKey: 'upsell.freeCeilingReached',
        featureLabel: t('upsell.feature.consoleCopyJson'),
      });
      return;
    }
    const text = payloadAsJsonString(payload);
    await writeToClipboard(text);
  }, [canCopyJson, payload, t]);

  // ESC closes the popover — the OverlayBackdrop already wires
  // outside-click close + Tab focus trap.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <OverlayBackdrop
      align="center"
      onClose={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('console.rich.detailsDialogLabel')}
    >
      <div
        className="relative w-[min(720px,90vw)] max-h-[min(80vh,720px)] overflow-hidden rounded-2xl border border-border-strong/80 bg-bg-panel shadow-xl"
      >
        <div className="flex items-center gap-1 border-b border-border-subtle/60 bg-bg-panel-alt px-3 py-2 text-[11px]">
          <Tooltip content={t('console.rich.previewShortcutTooltip')}>
            <button
              type="button"
              onClick={() => setTab('preview')}
              aria-pressed={tab === 'preview'}
              aria-label={t('console.rich.previewShortcutTooltip')}
              className={`rounded-md px-3 py-1 font-mono uppercase tracking-[0.14em] ${
                tab === 'preview'
                  ? 'border border-border-strong/80 bg-bg-panel text-foreground'
                  : 'text-fg-subtle hover:text-foreground'
              }`}
            >
              {t('console.rich.preview')}
            </button>
          </Tooltip>
          <Tooltip content={t('console.rich.rawJsonShortcutTooltip')}>
            <button
              type="button"
              onClick={() => setTab('rawJson')}
              aria-pressed={tab === 'rawJson'}
              aria-label={t('console.rich.rawJsonShortcutTooltip')}
              className={`rounded-md px-3 py-1 font-mono uppercase tracking-[0.14em] ${
                tab === 'rawJson'
                  ? 'border border-border-strong/80 bg-bg-panel text-foreground'
                  : 'text-fg-subtle hover:text-foreground'
              }`}
            >
              {t('console.rich.rawJson')}
            </button>
          </Tooltip>
          {/* The type icon is decorative; the raw discriminator string
              (`'table'`, `'object'`, etc.) is intentionally not user-
              visible — it's English-only and reads as a debug artefact
              in a localized UI. Anyone needing the kind name has the
              Raw JSON tab one click away. */}
          <span
            aria-hidden="true"
            className="ml-2 select-none font-mono text-[10px] text-fg-subtle"
          >
            {typeIcon(payload)}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="rounded-md border border-border/60 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle hover:border-border/90 hover:text-foreground"
              data-pro-gated={!canCopyJson || undefined}
              data-testid="console-rich-copy-json"
            >
              {canCopyJson
                ? t('console.rich.copyAsJson')
                : t('console.rich.copyAsJsonPro')}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('console.rich.close')}
              className="rounded-md border border-transparent px-2 py-1 text-fg-subtle hover:border-border/60 hover:text-foreground"
            >
              ×
            </button>
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-3 font-mono text-[11px] leading-5">
          {tab === 'preview' ? (
            <PreviewBody payload={payload} />
          ) : (
            <pre className="whitespace-pre-wrap break-all text-foreground">
              {payloadAsJsonString(payload)}
            </pre>
          )}
        </div>
      </div>
    </OverlayBackdrop>
  );
}

/**
 * Body of the Preview tab — dispatch by kind. Compact rendering;
 * deeper expansion is handled inline (rows clickable on each Object
 * / Array). Recursion cap mirrors `MAX_SCOPE_DEPTH = 4` from the
 * variable inspector.
 */
function PreviewBody({ payload }: { payload: RichOutputPayload }) {
  switch (payload.kind) {
    case 'table':
      return <PreviewTable payload={payload} />;
    case 'map':
      return <PreviewMap payload={payload} />;
    case 'set':
      return <PreviewSet payload={payload} />;
    case 'object':
      return <PreviewObject value={payload} />;
    case 'array':
      return <PreviewArray value={payload} />;
    case 'date':
      return <pre className="text-foreground">{payload.iso}</pre>;
    case 'promise':
      return <pre className="text-foreground">Promise ({payload.state})</pre>;
    case 'rawText':
      return <pre className="whitespace-pre-wrap text-foreground">{payload.text}</pre>;
    case 'primitive':
      return <pre className="text-foreground">{payload.repr}</pre>;
    case 'function':
      return <pre className="text-foreground">ƒ {payload.name}</pre>;
    case 'error':
      return <RichValueError payload={payload} />;
    case 'image':
      return <RichValueImage payload={payload} />;
    case 'html':
      return <RichValueHtml payload={payload} />;
    case 'chart':
      return <RichValueChart payload={payload} />;
  }
}

function PreviewTable({ payload }: { payload: Extract<RichOutputPayload, { kind: 'table' }> }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-auto">
      <table className="min-w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-b border-border-subtle/60 text-fg-subtle">
            {payload.columns.map((col) => (
              <th key={col} className="px-2 py-1 text-left font-bold">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {payload.rows.map((row, rIdx) => (
            <tr key={rIdx} className="border-b border-border-subtle/30">
              {row.map((cell, cIdx) => (
                <td key={cIdx} className="px-2 py-1 align-top text-foreground">
                  {scopeValueToString(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {payload.truncatedRowCount !== undefined && (
        <p className="mt-2 text-[10px] text-fg-subtle">
          {t('console.rich.moreCount', { count: payload.truncatedRowCount })}
        </p>
      )}
    </div>
  );
}

function PreviewMap({ payload }: { payload: Extract<RichOutputPayload, { kind: 'map' }> }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-0.5">
      {payload.entries.map((entry, idx) => (
        <div key={idx} className="flex gap-2">
          <span className="text-info">{scopeValueToString(entry.key)}</span>
          <span className="text-fg-subtle">→</span>
          <span className="text-foreground">{scopeValueToString(entry.value)}</span>
        </div>
      ))}
      {payload.truncatedCount !== undefined && (
        <p className="text-[10px] text-fg-subtle">
          {t('console.rich.moreCount', { count: payload.truncatedCount })}
        </p>
      )}
    </div>
  );
}

function PreviewSet({ payload }: { payload: Extract<RichOutputPayload, { kind: 'set' }> }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-0.5">
      {payload.entries.map((entry, idx) => (
        <div key={idx} className="text-foreground">
          {scopeValueToString(entry)}
        </div>
      ))}
      {payload.truncatedCount !== undefined && (
        <p className="text-[10px] text-fg-subtle">
          {t('console.rich.moreCount', { count: payload.truncatedCount })}
        </p>
      )}
    </div>
  );
}

function PreviewObject({
  value,
}: {
  value: Extract<RichOutputPayload, { kind: 'object' }>;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-0.5">
      {value.entries.map((entry) => (
        <div key={entry.key} className="flex gap-2">
          <span className="text-info">{entry.key}:</span>
          <span className="text-foreground">{scopeValueToString(entry.value)}</span>
        </div>
      ))}
      {value.truncatedCount !== undefined && (
        <p className="text-[10px] text-fg-subtle">
          {t('console.rich.moreCount', { count: value.truncatedCount })}
        </p>
      )}
    </div>
  );
}

function PreviewArray({
  value,
}: {
  value: Extract<RichOutputPayload, { kind: 'array' }>;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-0.5">
      {value.entries.map((entry) => (
        <div key={entry.index} className="flex gap-2">
          <span className="text-fg-subtle">[{entry.index}]</span>
          <span className="text-foreground">{scopeValueToString(entry.value)}</span>
        </div>
      ))}
      {value.truncatedCount !== undefined && (
        <p className="text-[10px] text-fg-subtle">
          {t('console.rich.moreCount', { count: value.truncatedCount })}
        </p>
      )}
    </div>
  );
}

/** Linear stringification of a ScopeValue cell. Bounded to one line. */
function scopeValueToString(value: import('../../../shared/scopeSnapshot').ScopeValue): string {
  switch (value.kind) {
    case 'primitive':
      return value.repr;
    case 'function':
      return `ƒ ${value.name}`;
    case 'object': {
      const sample = value.entries
        .slice(0, 3)
        .map((entry) => `${entry.key}: …`)
        .join(', ');
      return `${value.previewType}{${sample}${value.entries.length > 3 ? ', …' : ''}}`;
    }
    case 'array': {
      const sample = value.entries
        .slice(0, 3)
        .map((entry) => {
          switch (entry.value.kind) {
            case 'primitive':
              return entry.value.repr;
            case 'function':
              return 'ƒ';
            case 'object':
              return entry.value.previewType + '{}';
            case 'array':
              return `[${entry.value.length}]`;
            case 'error':
              return '!';
          }
        })
        .join(', ');
      return `[${sample}${value.length > 3 ? ', …' : ''}]`;
    }
    case 'error':
      return value.message;
  }
}
