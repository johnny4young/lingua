import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { downloadTextFile, downloadFile, exportFullResult, exportLoadedRows } = vi.hoisted(() => ({
  downloadTextFile: vi.fn(),
  downloadFile: vi.fn(),
  exportFullResult: vi.fn(),
  exportLoadedRows: vi.fn(async () => new Uint8Array([80, 75])),
}));
vi.mock('../../../src/renderer/utils/downloadTextFile', () => ({ downloadTextFile, downloadFile }));
vi.mock('../../../src/renderer/components/SqlWorkspace/sqlFullExport', () => ({ exportFullResult, exportLoadedRows }));

import { SqlExportDialog } from '../../../src/renderer/components/SqlWorkspace/SqlExportDialog';
import { SqlResultPreview } from '../../../src/renderer/components/SqlWorkspace/SqlResultPreview';
import { SqlExportError } from '../../../src/renderer/runtime/duckdbExport';
import { useUIStore } from '../../../src/renderer/stores/uiStore';
import type { SqlResponseV1 } from '../../../src/shared/sqlWorkspace';

const columns = [{ name: 'a', type: 'Int64' }];
const rows = Array.from({ length: 3 }, (_, i) => ({ a: String(i) }));
const fullResult = { sql: 'SELECT a FROM t', timeoutMs: 30_000 };

function dialog(props: Partial<Parameters<typeof SqlExportDialog>[0]> = {}) {
  const onClose = vi.fn();
  render(
    <SqlExportDialog
      columns={columns}
      rows={rows}
      totalRowCount={50_000}
      totalIsLowerBound
      fullSql="SELECT a FROM t"
      handoffs={{ fullResult }}
      onClose={onClose}
      {...props}
    />
  );
  return onClose;
}

beforeEach(async () => {
  await i18next.changeLanguage('en');
  useUIStore.setState({ statusNotice: null });
  vi.clearAllMocks();
});

describe('full-result export', () => {
  it('reads the whole result when the grid holds only part of it, with progress', async () => {
    const user = userEvent.setup();
    let finish!: (value: unknown) => void;
    exportFullResult.mockImplementation(
      (_sql: string, _format: string, _options: unknown, context: { onProgress: (rows: number) => void }) =>
        new Promise((resolve) => {
          context.onProgress(12_000);
          finish = resolve;
        })
    );
    const onClose = dialog();
    expect(screen.getByTestId('sql-export-scope-full').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('sql-export-count').textContent).toBe('Every row of the result · at least 50,000');
    await user.click(screen.getByTestId('sql-export-format-ndjson'));
    await user.click(screen.getByTestId('sql-export-download'));

    expect(exportFullResult).toHaveBeenCalledWith(
      'SELECT a FROM t',
      'ndjson',
      expect.objectContaining({ header: true }),
      expect.objectContaining({ timeoutMs: 30_000 })
    );
    expect((await screen.findByTestId('sql-export-progress')).textContent).toBe('Exporting… 12,000 rows read');
    finish({ data: new Uint8Array([123]), rowCount: 64_000, truncated: false });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(downloadFile).toHaveBeenCalledWith(new Uint8Array([123]), expect.stringMatching(/\.ndjson$/), expect.stringContaining('ndjson'));
    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'success',
      messageKey: 'sqlWorkspace.export.exported',
      values: { format: 'NDJSON', count: 64_000, formatted: '64,000' },
    });
  });

  it('cancels a running export and says so', async () => {
    const user = userEvent.setup();
    exportFullResult.mockImplementation(
      (_sql: string, _format: string, _options: unknown, context: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          context.signal.addEventListener('abort', () => reject(new SqlExportError('cancelled', 'Query cancelled')));
        })
    );
    const onClose = dialog();
    await user.click(screen.getByTestId('sql-export-download'));
    await user.click(await screen.findByTestId('sql-export-cancel'));
    await waitFor(() =>
      expect(useUIStore.getState().statusNotice).toMatchObject({ tone: 'info', messageKey: 'sqlWorkspace.export.cancelled' })
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('sql-export-download')).toBeTruthy();
    expect(screen.queryByTestId('sql-export-progress')).toBeNull();
  });

  it('warns when the format held fewer rows than the result', async () => {
    const user = userEvent.setup();
    exportFullResult.mockResolvedValue({ data: new Uint8Array([1]), rowCount: 1_048_575, truncated: true });
    dialog();
    await user.click(screen.getByTestId('sql-export-format-xlsx'));
    await user.click(screen.getByTestId('sql-export-download'));
    await waitFor(() =>
      expect(useUIStore.getState().statusNotice).toMatchObject({
        tone: 'warning',
        messageKey: 'sqlWorkspace.export.truncated',
        values: { format: 'XLSX', formatted: '1,048,575' },
      })
    );
  });

  it('reports what DuckDB said when the export fails', async () => {
    const user = userEvent.setup();
    exportFullResult.mockRejectedValue(new SqlExportError('sql-error', 'Out of Memory Error'));
    dialog();
    await user.click(screen.getByTestId('sql-export-download'));
    await waitFor(() =>
      expect(useUIStore.getState().statusNotice).toMatchObject({
        tone: 'error',
        messageKey: 'sqlWorkspace.export.failed',
        detail: 'Out of Memory Error',
      })
    );
  });
});

describe('loaded rows, copy and file-only formats', () => {
  it('exports the loaded rows as XLSX and keeps Copy for text formats', async () => {
    const user = userEvent.setup();
    const onClose = dialog();
    await user.click(screen.getByTestId('sql-export-scope-loaded'));
    expect(screen.getByTestId('sql-export-count').textContent).toContain('The first 3 of at least 50,000');
    await user.click(screen.getByTestId('sql-export-format-xlsx'));
    expect((screen.getByTestId('sql-export-copy') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('sql-export-blocked').textContent).toBe('XLSX and Parquet are files only. Copy takes the text formats.');
    await user.click(screen.getByTestId('sql-export-download'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(exportLoadedRows).toHaveBeenCalledWith('xlsx', columns, rows, expect.any(Object));
    expect(exportFullResult).not.toHaveBeenCalled();
    expect(downloadFile).toHaveBeenCalledWith(new Uint8Array([80, 75]), expect.stringMatching(/\.xlsx$/), expect.stringContaining('spreadsheetml'));
  });

  it('copies only the loaded rows, up to the clipboard cap', async () => {
    const user = userEvent.setup();
    dialog({ rows: Array.from({ length: 10_001 }, (_, i) => ({ a: String(i) })) });
    expect((screen.getByTestId('sql-export-copy') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('sql-export-blocked').textContent).toBe('Copy takes the loaded rows. Choose Loaded rows to copy.');
    await user.click(screen.getByTestId('sql-export-scope-loaded'));
    expect(screen.getByTestId('sql-export-blocked').textContent).toBe('Copy holds up to 10,000 rows. Export a file instead.');
  });

  it('writes Parquet from the query only, and explains when there is none', async () => {
    const user = userEvent.setup();
    dialog({ fullSql: undefined, handoffs: {}, totalRowCount: 3, totalIsLowerBound: false });
    expect(screen.queryByTestId('sql-export-scope-full')).toBeNull();
    await user.click(screen.getByTestId('sql-export-format-parquet'));
    expect((screen.getByTestId('sql-export-download') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('sql-export-blocked').textContent).toContain('DuckDB writes Parquet from the query');
  });
});

describe('from the result grid', () => {
  it('exports the grid as SQL: filters, sort and shown columns over the source query', async () => {
    const user = userEvent.setup();
    exportFullResult.mockResolvedValue({ data: 'x', rowCount: 1, truncated: false });
    const response: SqlResponseV1 = {
      version: 1,
      status: 'too-large',
      rows: [{ a: '1', b: 'x' }],
      columns: [
        { name: 'a', type: 'Int64' },
        { name: 'b', type: 'Utf8' },
      ],
      rowCount: 20,
      rowCountIsLowerBound: true,
      durationMs: 3,
      tooLarge: true,
      statementCount: 1,
      recordedAt: '2026-10-21T10:00:00.000Z',
    };
    render(
      <SqlResultPreview
        response={response}
        isExecuting={false}
        rowDisplayLimit={1_000}
        source={{ origin: 'editor', sql: 'SELECT * FROM t;' }}
        handoffs={{ fullResult }}
      />
    );
    await user.click(screen.getAllByTestId('sql-result-preview-sort')[0]!);
    await user.click(screen.getByTestId('sql-result-preview-export'));
    await user.click(screen.getByTestId('sql-export-download'));
    expect(exportFullResult.mock.calls[0]![0]).toBe('SELECT *\nFROM (\nSELECT * FROM t\n) AS result\nORDER BY "a" ASC');
  });

  it('copies a connection result to Local with progress, and Cancel aborts the copy', async () => {
    const user = userEvent.setup();
    let seen: { signal: AbortSignal; onProgress: (rows: number) => void } | undefined;
    const onSave = vi.fn(
      (_name: string, context?: { signal: AbortSignal; onProgress: (rows: number) => void }) =>
        new Promise<boolean>((resolve) => {
          seen = context;
          context?.onProgress(12_000);
          context?.signal.addEventListener('abort', () => resolve(false));
        })
    );
    const onClose = dialog({ handoffs: { remote: true, saveAsTable: { copy: true, suggestedName: 'orders', existingNames: [], onSave } } });
    expect(screen.getByTestId('sql-export-handoffs').textContent).toContain('Copy to Local as table');
    await user.click(screen.getByTestId('sql-export-save-table'));
    expect(onSave).toHaveBeenCalledWith('orders', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByTestId('sql-export-copy-progress').textContent).toBe('Copying… 12,000 rows read');
    await user.click(screen.getByTestId('sql-export-copy-cancel'));
    expect(seen?.signal.aborted).toBe(true);
    await waitFor(() => expect(screen.queryByTestId('sql-export-copy-progress')).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the Copy to Local title on a connection result it cannot copy, and says why', () => {
    dialog({ handoffs: { remote: true } });
    expect(screen.getByTestId('sql-export-handoffs').textContent).toContain('Copy to Local as table');
    expect(screen.getByTestId('sql-export-save-table-unavailable').textContent).toBe('Copy to Local needs a single read query on the connection.');
  });
});
