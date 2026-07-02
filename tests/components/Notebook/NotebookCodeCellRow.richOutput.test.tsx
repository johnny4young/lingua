/**
 * T3 — notebook rich outputs. A stdout output that is a homogeneous
 * JSON array of objects renders as a table grid; everything else stays
 * plain text; stderr is never tabled.
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

function makeCell(outputs: NotebookCellOutputV1[]): NotebookCodeCellV1 {
  return {
    kind: 'code',
    id: 'cell-a',
    language: 'javascript',
    source: 'x',
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

describe('NotebookCodeCellRow — rich table output (T3)', () => {
  beforeAll(async () => {
    await initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('renders a homogeneous JSON-array stdout output as a table grid', () => {
    render(
      <NotebookCodeCellRow
        {...rowProps(
          makeCell([stdout('[{"a":1,"b":2},{"a":3,"b":4}]')])
        )}
      />
    );
    const grid = screen.getByTestId('rich-table-grid');
    expect(grid).toBeTruthy();
    // Column headers from the union of object keys.
    const headers = grid.querySelectorAll('th');
    expect(Array.from(headers).map((h) => h.textContent)).toEqual(['a', 'b']);
    // First body row carries the serialized cell values.
    const firstRow = grid.querySelector('tbody tr');
    expect(
      Array.from(firstRow!.querySelectorAll('td')).map((c) => c.textContent)
    ).toEqual(['1', '2']);
  });

  it('leaves a plain (non-array) stdout output as text', () => {
    render(
      <NotebookCodeCellRow {...rowProps(makeCell([stdout('hello world')]))} />
    );
    expect(screen.queryByTestId('rich-table-grid')).toBeNull();
    expect(screen.getByText('hello world')).toBeTruthy();
  });

  it('does not table a JSON array on stderr', () => {
    render(
      <NotebookCodeCellRow
        {...rowProps(
          makeCell([
            { kind: 'text', stream: 'stderr', text: '[{"a":1},{"a":2}]' },
          ])
        )}
      />
    );
    expect(screen.queryByTestId('rich-table-grid')).toBeNull();
    expect(screen.getByText('[{"a":1},{"a":2}]')).toBeTruthy();
  });

  it('leaves a non-homogeneous / non-object array as text', () => {
    render(
      <NotebookCodeCellRow {...rowProps(makeCell([stdout('[1, 2, 3]')]))} />
    );
    expect(screen.queryByTestId('rich-table-grid')).toBeNull();
    expect(screen.getByText('[1, 2, 3]')).toBeTruthy();
  });
});
