import { Download, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SqlForeignKey } from '../../runtime/sqlForeignKeys';
import { formatNumber } from '../../i18n/formatNumber';
import { formatByteSize, hexDump, toDataUrl, viewCell } from './sqlCellValue';
import { renderCell } from './sqlResultFormatters';

const LABEL = 'font-mono text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle';

function downloadBytes(bytes: Uint8Array, name: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Who points at the selected row: one chip per foreign key, with its count. */
function ReferencedBy({
  incoming,
  row,
  countReferences,
  onOpen,
}: {
  incoming: ReadonlyArray<SqlForeignKey>;
  row: Record<string, unknown>;
  countReferences: (key: SqlForeignKey, value: unknown) => Promise<number | null>;
  onOpen: (key: SqlForeignKey, value: unknown) => void;
}) {
  const { t, i18n } = useTranslation();
  const [counts, setCounts] = useState<ReadonlyArray<number | null> | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all(incoming.map((key) => countReferences(key, row[key.refColumn]))).then((next) => {
      if (live) setCounts(next);
    });
    return () => {
      live = false;
    };
  }, [incoming, row, countReferences]);
  return (
    <div data-testid="sql-value-referenced-by" className="mt-3 flex flex-wrap gap-1.5">
      {incoming.map((key, index) => (
        <button
          key={`${key.table}.${key.column}`}
          type="button"
          onClick={() => onOpen(key, row[key.refColumn])}
          data-testid="sql-value-referenced-by-chip"
          className="focus-ring inline-flex h-6 items-center rounded-full border border-border-default px-2.5 text-caption text-fg-muted hover:text-fg-base"
        >
          {t('sqlWorkspace.value.referencedBy', {
            table: key.table,
            count: counts?.[index] === null || counts === null ? '…' : formatNumber(counts[index]!, i18n.language),
          })}
        </button>
      ))}
    </div>
  );
}

/** Side panel for the selected cell: JSON pretty-printed, a BLOB as image, hex and size, or long text. */
export function SqlValueViewer({
  column,
  duckType,
  value,
  row,
  incoming,
  countReferences,
  onOpenReference,
  onClose,
}: {
  column: string;
  duckType: string;
  value: unknown;
  row: Record<string, unknown>;
  incoming?: ReadonlyArray<SqlForeignKey>;
  countReferences?: (key: SqlForeignKey, value: unknown) => Promise<number | null>;
  onOpenReference?: (key: SqlForeignKey, value: unknown) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const view = useMemo(() => viewCell(value, duckType), [value, duckType]);
  const [hex, setHex] = useState(false);
  const imageUrl = useMemo(
    () => (view.kind === 'blob' && view.mime ? toDataUrl(view.bytes, view.mime) : null),
    [view]
  );

  return (
    <aside
      data-testid="sql-value-viewer"
      aria-label={t('sqlWorkspace.value.label', { column })}
      className="flex h-full w-[290px] shrink-0 flex-col overflow-hidden border-l border-border-subtle bg-bg-panel"
    >
      <header className="flex h-[34px] shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <span className={`${LABEL} min-w-0 flex-1 truncate`} title={`${column} (${duckType})`}>
          {t('sqlWorkspace.value.title', { column, type: duckType })}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('sqlWorkspace.value.close')}
          title={t('sqlWorkspace.value.close')}
          data-testid="sql-value-viewer-close"
          className="focus-ring inline-flex h-[22px] w-[22px] items-center justify-center rounded-md text-fg-subtle hover:bg-bg-panel-alt hover:text-fg-base"
        >
          <X size={12} aria-hidden="true" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2.5">
        {view.kind === 'null' ? (
          <p className="font-mono text-body-sm italic text-fg-subtle">{renderCell(null)}</p>
        ) : view.kind === 'json' ? (
          <pre data-testid="sql-value-json" className="whitespace-pre-wrap break-words font-mono text-caption leading-[19px] text-fg-base">
            {view.pretty}
          </pre>
        ) : view.kind === 'blob' ? (
          <div data-testid="sql-value-blob" className="flex flex-col gap-2">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={t('sqlWorkspace.value.imageAlt', { column })}
                data-testid="sql-value-image"
                className="max-h-[180px] max-w-full self-start rounded border border-border-subtle object-contain"
              />
            ) : null}
            <p className="text-caption text-fg-muted">
              {[view.mime?.replace('image/', '').toUpperCase() ?? t('sqlWorkspace.value.binary'), formatByteSize(view.bytes.length)].join(' · ')}
            </p>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => downloadBytes(view.bytes, `${column}.${view.mime?.split('/')[1] ?? 'bin'}`, view.mime ?? 'application/octet-stream')}
                data-testid="sql-value-save"
                className="button-secondary inline-flex items-center gap-1.5"
              >
                <Download size={12} aria-hidden="true" />
                {t('sqlWorkspace.value.saveAs')}
              </button>
              <button type="button" aria-pressed={hex} onClick={() => setHex((v) => !v)} data-testid="sql-value-hex-toggle" className="button-secondary">
                {t('sqlWorkspace.value.hex')}
              </button>
            </div>
            {hex ? (
              <pre data-testid="sql-value-hex" className="overflow-x-auto font-mono text-micro leading-[17px] text-fg-muted">
                {hexDump(view.bytes)}
              </pre>
            ) : null}
          </div>
        ) : (
          <>
            <p data-testid="sql-value-text" className="whitespace-pre-wrap break-words font-mono text-caption leading-[19px] text-fg-base">
              {view.text}
            </p>
            {view.text.length > 80 ? (
              <p className="mt-2 text-micro text-fg-subtle">
                {t('sqlWorkspace.value.length', { count: view.text.length, formatted: formatNumber(view.text.length, i18n.language) })}
              </p>
            ) : null}
          </>
        )}
        {incoming && incoming.length > 0 && countReferences && onOpenReference ? (
          <ReferencedBy incoming={incoming} row={row} countReferences={countReferences} onOpen={onOpenReference} />
        ) : null}
      </div>
    </aside>
  );
}
