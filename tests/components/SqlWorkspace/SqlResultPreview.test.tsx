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

  it('discloses when copy actions use a truncated preview', async () => {
    const user = userEvent.setup();
    render(
      <SqlResultPreview
        response={response({
          status: 'too-large',
          rowCount: 20,
          tooLarge: true,
        })}
        isExecuting={false}
        rowDisplayLimit={1000}
        knownTableNames={[]}
        onShowTables={vi.fn()}
      />
    );

    await user.click(screen.getByTestId('sql-result-preview-copy-json'));

    await waitFor(() => {
      expect(useUIStore.getState().statusNotice).toMatchObject({
        tone: 'success',
        messageKey: 'sqlWorkspace.action.copiedJsonPreview',
        values: { shown: 1, total: 20 },
      });
    });
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
    it('exports the on-screen rows to a CSV file with a success notice', async () => {
      const user = userEvent.setup();
      render(
        <SqlResultPreview
          response={response({
            rows: [{ a: 1 }, { a: 2 }],
            rowCount: 2,
          })}
          isExecuting={false}
          rowDisplayLimit={1000}
        />
      );

      // Menu is closed until the trigger is clicked.
      expect(screen.queryByTestId('sql-result-preview-export-menu')).toBeNull();
      await user.click(screen.getByTestId('sql-result-preview-export'));
      expect(screen.getByTestId('sql-result-preview-export-menu')).toBeTruthy();

      await user.click(screen.getByTestId('sql-result-preview-export-csv'));

      expect(downloadSpy).toHaveBeenCalledTimes(1);
      const [content, filename, mime] = downloadSpy.mock.calls[0]!;
      expect(content).toContain('a');
      expect(content).toContain('1');
      expect(content).toContain('2');
      expect(filename).toMatch(/^lingua-sql-\d{8}-\d{6}\.csv$/);
      expect(mime).toContain('text/csv');
      // The menu closes after a pick.
      expect(screen.queryByTestId('sql-result-preview-export-menu')).toBeNull();

      expect(useUIStore.getState().statusNotice).toMatchObject({
        tone: 'success',
        messageKey: 'sqlWorkspace.action.exportedCsv',
      });
    });

    it('exports JSON with a .json extension', async () => {
      const user = userEvent.setup();
      render(
        <SqlResultPreview
          response={response()}
          isExecuting={false}
          rowDisplayLimit={1000}
        />
      );
      await user.click(screen.getByTestId('sql-result-preview-export'));
      await user.click(screen.getByTestId('sql-result-preview-export-json'));

      const [, filename, mime] = downloadSpy.mock.calls[0]!;
      expect(filename).toMatch(/\.json$/);
      expect(mime).toContain('application/json');
      expect(useUIStore.getState().statusNotice).toMatchObject({
        messageKey: 'sqlWorkspace.action.exportedJson',
      });
    });

    it('discloses when the export uses a truncated preview', async () => {
      const user = userEvent.setup();
      render(
        <SqlResultPreview
          response={response({
            status: 'too-large',
            rowCount: 20,
            tooLarge: true,
          })}
          isExecuting={false}
          rowDisplayLimit={1000}
        />
      );
      await user.click(screen.getByTestId('sql-result-preview-export'));
      await user.click(screen.getByTestId('sql-result-preview-export-markdown'));

      expect(useUIStore.getState().statusNotice).toMatchObject({
        tone: 'success',
        messageKey: 'sqlWorkspace.action.exportedMarkdownPreview',
        values: { shown: 1, total: 20 },
      });
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

      await user.click(screen.getByTestId('sql-result-preview-profile'));
      expect(screen.getByTestId('sql-column-profile-loading')).toBeTruthy();
      expect(onProfileQuery).toHaveBeenCalledWith('SELECT score FROM metrics');

      resolveProfile?.(successfulProfile);
      await waitFor(() => {
        expect(screen.getByTestId('sql-column-profile-panel').textContent).toContain('score');
      });

      await user.click(screen.getByTestId('sql-column-profile-close'));
      expect(screen.queryByTestId('sql-column-profile-panel')).toBeNull();
      expect(screen.getByTestId('sql-result-preview')).toBeTruthy();
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
      expect(screen.queryByTestId('sql-result-preview-profile')).toBeNull();

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
      expect(screen.queryByTestId('sql-result-preview-profile')).toBeNull();
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

      await user.click(screen.getByTestId('sql-result-preview-profile'));
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

      await user.click(screen.getByTestId('sql-result-preview-profile'));

      expect(onProfileQuery).toHaveBeenCalledWith('SELECT score FROM metrics');
      expect(onProfileQuery).not.toHaveBeenCalledWith(
        'SELECT changed_draft FROM metrics'
      );
    });
  });
});
