/**
 * Answers beside the lines of a notebook cell: the answer column, its
 * leaders in the static view, the query table beside a SQL cell, the folded
 * output and the run number in the margin.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { initI18n } from '../../../src/renderer/i18n';
import { NotebookCodeCellRow } from '../../../src/renderer/components/Notebook/NotebookCodeCellRow';
import type { NotebookCodeCellV1 } from '../../../src/shared/notebook';
import type { NotebookCellRunStatus } from '../../../src/renderer/stores/notebookStore';

vi.mock('@monaco-editor/react', async () => {
  const m = await import('../../__fixtures__/monacoEditorMock');
  return m.makeMonacoEditorMock();
});

function rowProps(cell: NotebookCodeCellV1, status: NotebookCellRunStatus = 'ok', executionOrder: number | null = 4) {
  return {
    cell,
    cellIndex: 2,
    status,
    executionOrder,
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

const pythonCell: NotebookCodeCellV1 = {
  kind: 'code',
  id: 'cell-py',
  language: 'python',
  source: "from statistics import mean\ntickets = [151.2, 146.9, 130.86]\navg = mean(tickets)\nprint('done')",
  outputs: [{ kind: 'text', stream: 'stdout', text: 'done' }],
  answers: [
    { line: 2, kind: 'value', text: '[151.2, 146.9, 130.86]', type: 'list', size: 3 },
    { line: 3, kind: 'value', text: '142.98666666666668', type: 'float' },
    { line: 4, kind: 'output', text: 'done' },
  ],
};

describe('NotebookCodeCellRow — answers beside the lines', () => {
  beforeAll(async () => {
    await initI18n('en');
  });
  afterEach(async () => {
    await i18next.changeLanguage('en');
  });

  it('answers each line in the column, with a leader from the line end', () => {
    render(<NotebookCodeCellRow {...rowProps(pythonCell)} />);
    const column = screen.getByTestId('notebook-cell-answers');
    expect(column.getAttribute('aria-label')).toBe('Answers for cell 3');
    const answers = within(column).getAllByTestId('notebook-cell-answer');
    expect(answers.map(answer => answer.getAttribute('data-line'))).toEqual(['2', '3', '4']);
    expect(answers[0]!.textContent).toBe('list·3130.86 – 151.2');
    expect(answers[1]!.textContent).toBe('float142.98666666666668');
    expect(answers[2]!.textContent).toBe('printdone');
    // Answers sit on their source line in the grid.
    expect(answers[1]!.style.gridRow).toBe('3');
    const leaders = screen.getAllByTestId('notebook-cell-answer-leader');
    expect(leaders).toHaveLength(3);
    expect(leaders[0]!.style.left).toBe('calc(32ch + 22px)');
  });

  it('folds the printed output away while its lines answer', () => {
    render(<NotebookCodeCellRow {...rowProps(pythonCell)} />);
    const toggle = screen.getByTestId('notebook-code-cell-output-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toBe('1 output line');
    expect(screen.queryByTestId('notebook-code-cell-outputs')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByTestId('notebook-code-cell-outputs').textContent).toContain('done');
  });

  it('draws a query result as a table beside the SQL cell', () => {
    const cell: NotebookCodeCellV1 = {
      kind: 'code',
      id: 'cell-sql',
      language: 'sql',
      source: 'SELECT city, revenue, share\nFROM by_city\nORDER BY revenue DESC',
      outputs: [
        {
          kind: 'text',
          stream: 'stdout',
          text: JSON.stringify([
            { city: 'Medellín', revenue: '818294.40', share: 33.9 },
            { city: 'Cali', revenue: '301763.16', share: 12.5 },
          ]),
        },
      ],
      answers: [{ line: 1, kind: 'result', text: '', rows: 2, columns: 3 }],
    };
    render(<NotebookCodeCellRow {...rowProps(cell)} />);
    const table = screen.getByTestId('notebook-cell-answer-table');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(table.textContent).toContain('Medellín');
    // The last measurable numeric column carries the bars.
    expect(table.querySelectorAll('.notebook-answer-track')).toHaveLength(2);
    expect(screen.getByTestId('notebook-cell-answer').style.gridRow).toBe('1 / -1');
  });

  it('summarizes a made table in Spanish', async () => {
    await i18next.changeLanguage('es');
    const cell: NotebookCodeCellV1 = {
      kind: 'code',
      id: 'cell-made',
      language: 'sql',
      source: 'CREATE TABLE by_city AS\nSELECT * FROM orders;',
      outputs: [],
      answers: [{ line: 2, kind: 'table', text: 'by_city', rows: 12, columns: 3 }],
    };
    render(<NotebookCodeCellRow {...rowProps(cell)} />);
    expect(screen.getByTestId('notebook-cell-answer').textContent).toBe('tableby_city12filas× 3 columnas');
    expect(screen.getByTestId('notebook-code-cell-execution-order').getAttribute('aria-label')).toBe('Ejecución 4');
  });

  it('marks stale answers and hides answers while an unsaved draft moves the lines', () => {
    const { rerender } = render(<NotebookCodeCellRow {...rowProps(pythonCell, 'stale')} />);
    expect(screen.getByTestId('notebook-cell-answers').getAttribute('data-stale')).toBe('true');
    rerender(<NotebookCodeCellRow {...rowProps({ ...pythonCell, answers: undefined })} />);
    expect(screen.queryByTestId('notebook-cell-answers')).toBeNull();
    expect(screen.queryByTestId('notebook-cell-answer-leader')).toBeNull();
  });

  it('opens the editor from the code, not from its horizontal scrollbar', () => {
    render(<NotebookCodeCellRow {...rowProps(pythonCell)} />);
    const view = screen.getByTestId('notebook-code-cell-static');
    Object.defineProperty(view, 'clientHeight', { value: 80 });
    const onScrollbar = new MouseEvent('mousedown', { bubbles: true });
    Object.defineProperty(onScrollbar, 'offsetY', { value: 84 });
    fireEvent(view, onScrollbar);
    expect(screen.queryByTestId('notebook-code-cell-static')).not.toBeNull();
    fireEvent.mouseDown(view);
    expect(screen.queryByTestId('notebook-code-cell-static')).toBeNull();
  });

  it('shows the run number in the margin, or a dash before the first run', () => {
    const { rerender } = render(<NotebookCodeCellRow {...rowProps(pythonCell)} />);
    const margin = screen.getByTestId('notebook-code-cell-execution-order');
    expect(margin.getAttribute('aria-label')).toBe('Run 4');
    expect(margin.textContent).toBe('4run');
    rerender(<NotebookCodeCellRow {...rowProps({ ...pythonCell, answers: undefined }, 'idle', null)} />);
    expect(screen.getByTestId('notebook-code-cell-execution-order').textContent).toBe('–Not run');
  });
});
