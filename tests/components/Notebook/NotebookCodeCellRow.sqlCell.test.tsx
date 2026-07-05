/**
 * T16 — SQL notebook cells (user-facing render surface).
 *
 * Verifies the pieces the runner tests cannot: that a `language: 'sql'`
 * code cell renders in the real React tree with real i18n — the language
 * selector offers an enabled SQL option, the shared-engine hint renders
 * (no missing i18n key), and a SQL result set (emitted by the runner as a
 * JSON-array stdout entry) upgrades to the same `rich-table-grid` the T3
 * table path produces.
 */

import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { initI18n } from '../../../src/renderer/i18n';
import { NotebookCodeCellRow } from '../../../src/renderer/components/Notebook/NotebookCodeCellRow';
import type {
  NotebookCellOutputV1,
  NotebookCodeCellV1,
} from '../../../src/shared/notebook';

vi.mock('@monaco-editor/react', async () => {
  const m = await import('../../__fixtures__/monacoEditorMock');
  return m.makeMonacoEditorMock();
});

function makeSqlCell(outputs: NotebookCellOutputV1[]): NotebookCodeCellV1 {
  return {
    kind: 'code',
    id: 'cell-sql',
    language: 'sql',
    source: 'SELECT 1 AS n;',
    outputs,
  };
}

function rowProps(cell: NotebookCodeCellV1) {
  return {
    cell,
    cellIndex: 0,
    status: 'ok' as const,
    isActive: false,
    canMoveUp: false,
    canMoveDown: false,
    disabled: false,
    onActivate: vi.fn(),
    onSourceChange: vi.fn(),
    onRunCell: vi.fn(),
    onMoveUp: vi.fn(),
    onMoveDown: vi.fn(),
    onDelete: vi.fn(),
    onLanguageChange: vi.fn(),
  };
}

const stdout = (text: string): NotebookCellOutputV1 => ({
  kind: 'text',
  stream: 'stdout',
  text,
});

describe('NotebookCodeCellRow — SQL cell (T16)', () => {
  beforeAll(async () => {
    await initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('offers an enabled SQL option in the language selector, selected', () => {
    render(<NotebookCodeCellRow {...rowProps(makeSqlCell([]))} />);
    const select = screen.getByTestId('notebook-code-cell-language') as HTMLSelectElement;
    expect(select.value).toBe('sql');
    const sqlOption = Array.from(select.options).find((o) => o.value === 'sql');
    expect(sqlOption).toBeTruthy();
    expect(sqlOption!.disabled).toBe(false);
  });

  it('renders the shared-engine hint (i18n key resolves)', () => {
    render(<NotebookCodeCellRow {...rowProps(makeSqlCell([]))} />);
    const hint = screen.getByTestId('notebook-code-cell-sql-hint');
    expect(hint.textContent).toContain('DuckDB');
  });

  it('renders a SQL result set (JSON-array stdout) as a table grid', () => {
    // Exactly the shape the runner emits on a successful query.
    const rows = [
      { n: 1, label: 'a' },
      { n: 2, label: 'b' },
    ];
    render(
      <NotebookCodeCellRow
        {...rowProps(makeSqlCell([stdout(JSON.stringify(rows))]))}
      />
    );
    const grid = screen.getByTestId('rich-table-grid');
    const headers = Array.from(grid.querySelectorAll('th')).map((h) => h.textContent);
    expect(headers).toEqual(['n', 'label']);
    const firstRow = grid.querySelector('tbody tr');
    // The T3 grid renders numbers bare and strings quoted.
    expect(
      Array.from(firstRow!.querySelectorAll('td')).map((c) => c.textContent)
    ).toEqual(['1', '"a"']);
  });

  it('leaves a DDL status line as plain text (no table)', () => {
    render(
      <NotebookCodeCellRow
        {...rowProps(makeSqlCell([stdout('Query OK — 0 row(s).')]))}
      />
    );
    expect(screen.queryByTestId('rich-table-grid')).toBeNull();
    expect(screen.getByText('Query OK — 0 row(s).')).toBeTruthy();
  });
});
