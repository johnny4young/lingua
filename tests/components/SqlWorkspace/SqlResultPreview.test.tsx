import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capture downloads instead of exercising the DOM Blob/anchor path.
const { downloadSpy } = vi.hoisted(() => ({ downloadSpy: vi.fn() }));
vi.mock('../../../src/renderer/utils/downloadTextFile', () => ({
  downloadTextFile: downloadSpy,
}));

import { SqlResultPreview } from '../../../src/renderer/components/SqlWorkspace/SqlResultPreview';
import type { SqlColumnProfileOutcome } from '../../../src/renderer/runtime/sqlColumnProfile';
import { useUIStore } from '../../../src/renderer/stores/uiStore';
import i18next from 'i18next';
import type { SqlResponseV1 } from '../../../src/shared/sqlWorkspace';

function response(overrides: Partial<SqlResponseV1> = {}): SqlResponseV1 {
  return {
    version: 1,
    status: 'success',
    rows: [{ a: 1 }],
    columns: [{ name: 'a', type: 'INTEGER' }],
    rowCount: 1,
    durationMs: 5,
    tooLarge: false,
    statementCount: 1,
    recordedAt: '2026-05-26T00:00:00.000Z',
    ...overrides,
  };
}

/** Read the first-column cell text for each rendered data row. */
function firstColumnCells(): string[] {
  return screen
    .getAllByTestId('sql-result-preview-row')
    .map((row) => row.querySelector('td')?.textContent ?? '');
}

describe('SqlResultPreview', () => {
  beforeEach(() => {
    downloadSpy.mockClear();
    useUIStore.setState({ statusNotice: null });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('labels columns with DuckDB type names and keeps the Arrow name as a tooltip', () => {
    render(
      <SqlResultPreview
        response={response({
          rows: [{ city: 'Cali', revenue: '12.50' }],
          columns: [
            { name: 'city', type: 'Utf8' },
            { name: 'revenue', type: 'Decimal[6e+2]' },
          ],
        })}
        isExecuting={false}
        rowDisplayLimit={1000}
      />
    );
    expect(screen.getByText('VARCHAR').getAttribute('title')).toBe('Arrow type: Utf8');
    expect(screen.getByText('DECIMAL(6,2)').getAttribute('title')).toBe('Arrow type: Decimal[6e+2]');
    expect(screen.queryByText('Utf8')).toBeNull();
  });

  it('right-aligns numeric columns by DuckDB type and renders null in italics', () => {
    render(
      <SqlResultPreview
        response={response({
          rows: [
            { city: 'Cali', orders: '12', revenue: '12.50' },
            { city: null, orders: null, revenue: '3.00' },
          ],
          columns: [
            { name: 'city', type: 'Utf8' },
            { name: 'orders', type: 'Int64' },
            { name: 'revenue', type: 'Decimal[6e+2]' },
          ],
          rowCount: 2,
        })}
        isExecuting={false}
        rowDisplayLimit={1000}
      />
    );
    const [first, second] = screen.getAllByTestId('sql-result-preview-row');
    const [city, orders, revenue] = [...first!.querySelectorAll('td')];
    expect(city!.className).not.toContain('text-right');
    expect(orders!.className).toContain('text-right');
    expect(revenue!.className).toContain('text-right');
    const nullCell = second!.querySelector('td[data-null="true"]')!;
    expect(nullCell.textContent).toBe('null');
    expect(nullCell.className).toContain('italic');
  });

  it('selects a row by click or arrow keys and copies it as JSON with Cmd/Ctrl+C', async () => {
    const user = userEvent.setup();
    // userEvent installs its own clipboard; spy on that one.
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    render(
      <SqlResultPreview
        response={response({ rows: [{ a: 1 }, { a: 2 }], rowCount: 2 })}
        isExecuting={false}
        rowDisplayLimit={1000}
      />
    );
    const rows = screen.getAllByTestId('sql-result-preview-row');
    await user.click(rows[0]!);
    expect(rows[0]!.getAttribute('aria-selected')).toBe('true');
    const grid = screen.getByTestId('sql-result-preview-table-container');
    grid.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByTestId('sql-result-preview-row')[1]!.getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{Control>}c{/Control}');
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(JSON.stringify({ a: 2 }, null, 2));
    });
    expect(useUIStore.getState().statusNotice?.messageKey).toBe('sqlWorkspace.grid.rowCopied');
  });

  it('shows the SQL that produced a table preview and hands it to the editor', async () => {
    const user = userEvent.setup();
    const onEditInEditor = vi.fn();
    render(
      <SqlResultPreview
        response={response()}
        isExecuting={false}
        rowDisplayLimit={1000}
        source={{ origin: 'table', sql: 'SELECT * FROM "cities" LIMIT 100;', tableName: 'cities' }}
        onEditInEditor={onEditInEditor}
      />
    );
    const strip = screen.getByTestId('sql-result-strip');
    expect(strip.textContent).toContain('SELECT * FROM "cities" LIMIT 100;');
    expect(strip.textContent).toContain('opened from cities');
    await user.click(screen.getByTestId('sql-result-strip-edit'));
    expect(onEditInEditor).toHaveBeenCalledWith('SELECT * FROM "cities" LIMIT 100;');
  });

  it('labels an editor run in the strip without an Edit in editor button', () => {
    render(
      <SqlResultPreview
        response={response()}
        isExecuting={false}
        rowDisplayLimit={1000}
        source={{ origin: 'editor', sql: 'SELECT 1' }}
        onEditInEditor={vi.fn()}
      />
    );
    expect(screen.getByTestId('sql-result-strip').textContent).toContain('ran from the editor');
    expect(screen.queryByTestId('sql-result-strip-edit')).toBeNull();
  });

  describe('column sort', () => {
    const multiRow = response({
      rows: [{ a: 3 }, { a: 1 }, { a: 2 }],
      rowCount: 3,
    });

    it('clicking a header sorts ascending, then descending, then off', async () => {
      const user = userEvent.setup();
      render(
        <SqlResultPreview
          response={multiRow}
          isExecuting={false}
          rowDisplayLimit={1000}
        />
      );

      // Original (insertion) order before any sort.
      expect(firstColumnCells()).toEqual(['3', '1', '2']);

      const header = screen.getByTestId('sql-result-preview-sort');
      // Ascending.
      await user.click(header);
      expect(header.getAttribute('data-sort')).toBe('asc');
      expect(firstColumnCells()).toEqual(['1', '2', '3']);

      // Descending.
      await user.click(header);
      expect(header.getAttribute('data-sort')).toBe('desc');
      expect(firstColumnCells()).toEqual(['3', '2', '1']);

      // Back to original order.
      await user.click(header);
      expect(header.getAttribute('data-sort')).toBe('none');
      expect(firstColumnCells()).toEqual(['3', '1', '2']);
    });
  });

  describe('result filter', () => {
    const rows = response({
      rows: [{ name: 'lingua' }, { name: 'duckdb' }, { name: 'react' }],
      columns: [{ name: 'name', type: 'VARCHAR' }],
      rowCount: 3,
    });

    it('filters visible rows to those matching the needle', async () => {
      const user = userEvent.setup();
      render(
        <SqlResultPreview
          response={rows}
          isExecuting={false}
          rowDisplayLimit={1000}
        />
      );

      expect(firstColumnCells()).toEqual(['lingua', 'duckdb', 'react']);

      await user.type(
        screen.getByTestId('sql-result-preview-filter'),
        'duck'
      );

      expect(firstColumnCells()).toEqual(['duckdb']);
      // The match-count chip surfaces once a filter is active (the
      // interpolated copy itself is exercised by the i18n locale tests).
      expect(
        screen.getByTestId('sql-result-preview-filter-count')
      ).toBeTruthy();
    });

    it('shows the filter-empty state when nothing matches', async () => {
      const user = userEvent.setup();
      render(
        <SqlResultPreview
          response={rows}
          isExecuting={false}
          rowDisplayLimit={1000}
        />
      );

      await user.type(
        screen.getByTestId('sql-result-preview-filter'),
        'zzz'
      );

      expect(
        screen.getByTestId('sql-result-preview-filter-empty')
      ).toBeTruthy();
      expect(screen.queryAllByTestId('sql-result-preview-row')).toHaveLength(0);
    });

    it('clearing the filter restores all rows', async () => {
      const user = userEvent.setup();
      render(
        <SqlResultPreview
          response={rows}
          isExecuting={false}
          rowDisplayLimit={1000}
        />
      );

      await user.type(
        screen.getByTestId('sql-result-preview-filter'),
        'react'
      );
      expect(firstColumnCells()).toEqual(['react']);

      await user.click(screen.getByTestId('sql-result-preview-filter-clear'));
      expect(firstColumnCells()).toEqual(['lingua', 'duckdb', 'react']);
    });
  });

  describe('run history', () => {
    it('renders a history entry per response and selects on click', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      const responses: SqlResponseV1[] = [
        response({ rowCount: 2, durationMs: 5 }),
        response({ rows: [], rowCount: 9, durationMs: 12 }),
      ];
      render(
        <SqlResultPreview
          response={responses[0]!}
          isExecuting={false}
          rowDisplayLimit={1000}
          responses={responses}
          selectedResponseIndex={0}
          onSelectResponse={onSelect}
        />
      );

      const entries = screen.getAllByTestId('sql-run-history-entry');
      expect(entries).toHaveLength(2);
      // Newest entry is the active selection.
      expect(entries[0]!.getAttribute('data-active')).toBe('true');

      await user.click(entries[1]!);
      expect(onSelect).toHaveBeenCalledWith(1);
    });

    it('hides the history list when there is only one run', () => {
      render(
        <SqlResultPreview
          response={response()}
          isExecuting={false}
          rowDisplayLimit={1000}
          responses={[response()]}
          selectedResponseIndex={0}
          onSelectResponse={vi.fn()}
        />
      );
      expect(screen.queryByTestId('sql-run-history')).toBeNull();
    });
  });

  describe('result export', () => {
    it('exports the fetched rows from the dialog with a success notice', async () => {
      const user = userEvent.setup();
      render(
        <SqlResultPreview
          response={response({ rows: [{ a: 1 }, { a: 2 }], rowCount: 2 })}
          isExecuting={false}
          rowDisplayLimit={1}
        />
      );
      expect(screen.queryByTestId('sql-export-dialog')).toBeNull();
      await user.click(screen.getByTestId('sql-result-preview-export'));
      expect(screen.getByTestId('sql-export-dialog')).toBeTruthy();
      await user.click(screen.getByTestId('sql-export-download'));

      expect(downloadSpy).toHaveBeenCalledTimes(1);
      const [content, filename, mime] = downloadSpy.mock.calls[0]!;
      // Every fetched row, not just the one the grid's display cap shows.
      expect(content).toBe('a\n1\n2');
      expect(filename).toMatch(/^lingua-sql-\d{8}-\d{6}\.csv$/);
      expect(mime).toContain('text/csv');
      expect(screen.queryByTestId('sql-export-dialog')).toBeNull();
      expect(useUIStore.getState().statusNotice).toMatchObject({
        tone: 'success',
        messageKey: 'sqlWorkspace.export.exported',
        values: { format: 'CSV', count: 2 },
      });
      expect(i18next.t('sqlWorkspace.export.exported', { format: 'CSV', count: 1 })).toBe(
        'Exported 1 row as CSV'
      );
    });

    it('copies the chosen format to the clipboard', async () => {
      const user = userEvent.setup();
      const writeText = vi.spyOn(navigator.clipboard, 'writeText');
      render(
        <SqlResultPreview response={response()} isExecuting={false} rowDisplayLimit={1000} />
      );
      await user.click(screen.getByTestId('sql-result-preview-export'));
      await user.click(screen.getByTestId('sql-export-format-sql-insert'));
      await user.click(screen.getByTestId('sql-export-copy'));
      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith(
          'INSERT INTO "result" ("a") VALUES\n  (1);'
        );
      });
    });

    it('says when the result holds only the first rows the query produced', async () => {
      const user = userEvent.setup();
      render(
        <SqlResultPreview
          response={response({ status: 'too-large', rowCount: 20, tooLarge: true })}
          isExecuting={false}
          rowDisplayLimit={1000}
        />
      );
      await user.click(screen.getByTestId('sql-result-preview-export'));
      expect(screen.getByTestId('sql-export-count').textContent).toContain('first 1 of 20');
    });

    it('calls a windowed total a lower bound', async () => {
      const user = userEvent.setup();
      render(
        <SqlResultPreview
          response={response({ status: 'too-large', rowCount: 20, tooLarge: true, rowCountIsLowerBound: true })}
          isExecuting={false}
          rowDisplayLimit={1000}
        />
      );
      expect(screen.getByTestId('sql-result-preview-too-large').textContent).toContain('of ≥ 20 rows');
      await user.click(screen.getByTestId('sql-result-preview-export'));
      expect(screen.getByTestId('sql-export-count').textContent).toContain('first 1 of at least 20');
    });

    it('offers Save as table only with a known source', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(true);
      render(
        <SqlResultPreview
          response={response()}
          isExecuting={false}
          rowDisplayLimit={1000}
          handoffs={{ saveAsTable: { suggestedName: 'result', existingNames: ['cities'], onSave } }}
        />
      );
      await user.click(screen.getByTestId('sql-result-preview-export'));
      const name = screen.getByTestId('sql-export-save-table-name') as HTMLInputElement;
      await user.clear(name);
      await user.type(name, 'cities');
      expect((screen.getByTestId('sql-export-save-table') as HTMLButtonElement).disabled).toBe(true);
      await user.clear(name);
      await user.type(name, 'top_cities');
      await user.click(screen.getByTestId('sql-export-save-table'));
      expect(onSave).toHaveBeenCalledWith('top_cities');
    });
  });

  describe('column profile', () => {
    const successfulProfile: SqlColumnProfileOutcome = {
      status: 'success',
      tooLarge: false,
      profiles: [
        {
          columnName: 'score',
          columnType: 'INTEGER',
          min: '1',
          max: '9',
          approximateUnique: '3',
          average: '5',
          standardDeviation: '2.5',
          nullPercentage: '0',
        },
      ],
    };

    it('rounds long float aggregates and keeps the exact value in the title', async () => {
      const user = userEvent.setup();
      const profile = { ...successfulProfile.profiles[0]!, standardDeviation: '4.242640687119285' };
      render(
        <SqlResultPreview
          response={response()}
          isExecuting={false}
          rowDisplayLimit={1000}
          profileQuerySource="SELECT score FROM metrics"
          onProfileQuery={() => Promise.resolve({ ...successfulProfile, profiles: [profile] })}
        />
      );
      await user.click(screen.getByRole('button', { name: 'Profile' }));
      const cell = await screen.findByTitle('4.242640687119285');
      expect(cell.textContent).toBe('4.2426');
    });

    it('opens an on-demand profile for the newest successful read query', async () => {
      const user = userEvent.setup();
      let resolveProfile: ((value: SqlColumnProfileOutcome) => void) | undefined;
      const onProfileQuery = vi.fn(
        () =>
          new Promise<SqlColumnProfileOutcome>((resolve) => {
            resolveProfile = resolve;
          })
      );
      render(
        <SqlResultPreview
          response={response()}
          isExecuting={false}
          rowDisplayLimit={1000}
          profileQuerySource="SELECT score FROM metrics"
          onProfileQuery={onProfileQuery}
        />
      );

      await user.click(screen.getByRole('button', { name: 'Profile' }));
      expect(screen.getByTestId('sql-column-profile-loading')).toBeTruthy();
      expect(onProfileQuery).toHaveBeenCalledWith('SELECT score FROM metrics');

      resolveProfile?.(successfulProfile);
      await waitFor(() => {
        expect(screen.getByTestId('sql-column-profile-panel').textContent).toContain('score');
      });

      // Profile is a tab: going back to Table leaves the result untouched.
      await user.click(screen.getByRole('button', { name: 'Table' }));
      expect(screen.queryByTestId('sql-column-profile-panel')).toBeNull();
      expect(screen.getByTestId('sql-result-preview-table')).toBeTruthy();
    });

    it('does not offer a profile for a mutating query or historical response', () => {
      const { rerender } = render(
        <SqlResultPreview
          response={response()}
          isExecuting={false}
          rowDisplayLimit={1000}
          profileQuerySource="DELETE FROM metrics"
          onProfileQuery={vi.fn()}
        />
      );
      expect(screen.queryByRole('button', { name: 'Profile' })).toBeNull();

      rerender(
        <SqlResultPreview
          response={response()}
          isExecuting={false}
          rowDisplayLimit={1000}
          profileQuerySource="SELECT score FROM metrics"
          onProfileQuery={vi.fn()}
          responses={[response(), response({ recordedAt: '2026-05-25T00:00:00.000Z' })]}
          selectedResponseIndex={1}
        />
      );
      expect(screen.queryByRole('button', { name: 'Profile' })).toBeNull();
    });

    it('shows the profile error and retries without mutating the SQL result', async () => {
      const user = userEvent.setup();
      const onProfileQuery = vi
        .fn<() => Promise<SqlColumnProfileOutcome>>()
        .mockRejectedValueOnce(new Error('profile failed'))
        .mockResolvedValueOnce(successfulProfile);
      render(
        <SqlResultPreview
          response={response()}
          isExecuting={false}
          rowDisplayLimit={1000}
          profileQuerySource="SELECT score FROM metrics"
          onProfileQuery={onProfileQuery}
        />
      );

      await user.click(screen.getByRole('button', { name: 'Profile' }));
      await waitFor(() => {
        expect(screen.getByTestId('sql-column-profile-error').textContent).toContain(
          'profile failed'
        );
      });
      await user.click(screen.getByTestId('sql-column-profile-retry'));

      await waitFor(() => {
        expect(screen.getByTestId('sql-column-profile-panel').textContent).toContain('score');
      });
      expect(onProfileQuery).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('sql-result-preview').getAttribute('data-state')).toBe('success');
    });

    it('profiles the source that produced the result, not a later editor draft', async () => {
      const user = userEvent.setup();
      const onProfileQuery = vi.fn().mockResolvedValue(successfulProfile);
      render(
        <SqlResultPreview
          response={response()}
          isExecuting={false}
          rowDisplayLimit={1000}
          querySource="SELECT changed_draft FROM metrics"
          profileQuerySource="SELECT score FROM metrics"
          onProfileQuery={onProfileQuery}
        />
      );

      await user.click(screen.getByRole('button', { name: 'Profile' }));

      expect(onProfileQuery).toHaveBeenCalledWith('SELECT score FROM metrics');
      expect(onProfileQuery).not.toHaveBeenCalledWith(
        'SELECT changed_draft FROM metrics'
      );
    });
  });
});
