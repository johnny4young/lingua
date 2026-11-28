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
    expect(answers[1]!.textContent).toBe('float142.9866667');
    expect(answers[2]!.textContent).toBe('stdoutdone');
    // The shared answer renderer draws them: bars for a numeric list, a number pill for a float.
    expect(within(answers[0]!).getByTestId('answer-picture-bars').querySelectorAll('rect')).toHaveLength(3);
    const value = within(answers[1]!).getByTestId('answer-object-value');
    expect(value.dataset.tone).toBe('number');
    expect(value.hasAttribute('data-pill')).toBe(true);
    expect(within(answers[2]!).getByTestId('answer-object').dataset.kind).toBe('stdout');
    // Only the last answer may wrap into the free lines below it.
    expect(within(answers[0]!).getByTestId('answer-object').hasAttribute('data-one-line')).toBe(true);
    expect(within(answers[2]!).getByTestId('answer-object').hasAttribute('data-one-line')).toBe(false);
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
    expect(table.textContent).toContain('818,294.40');
    // The last measurable numeric column carries the bars.
    expect(table.querySelectorAll('.notebook-answer-track')).toHaveLength(2);
    expect(screen.getByTestId('notebook-cell-answer').style.gridRow).toBe('1 / 5');
  });

  it('answers a JavaScript cell with script vocabulary, and an error in its tone', () => {
    const cell: NotebookCodeCellV1 = {
      kind: 'code',
      id: 'cell-js-answers',
      language: 'javascript',
      source: 'const n = 2n ** 70n;\nn\nnew Map([["a", 1]])\nnull.size',
      outputs: [],
      answers: [
        { line: 2, kind: 'value', text: '1180591620717411303424n', type: 'bigint' },
        { line: 3, kind: 'value', text: '[["a",1]]', type: 'map', size: 1 },
        { line: 4, kind: 'error', text: "TypeError: Cannot read properties of null (reading 'size')" },
      ],
    };
    render(<NotebookCodeCellRow {...rowProps(cell)} />);
    const answers = screen.getAllByTestId('notebook-cell-answer');
    expect(answers[0]!.textContent).toBe('bigint1180591620717411303424n');
    expect(within(answers[1]!).getByTestId('answer-object').textContent).toContain('map·1');
    expect(within(answers[2]!).getByTestId('answer-object').dataset.tone).toBe('error');
  });

  it('keeps the type and length of a list cut to the answer cap', () => {
    const cut = `[${Array.from({ length: 80 }, (_, i) => i).join(', ')}`.slice(0, 239) + '…';
    const cell: NotebookCodeCellV1 = {
      kind: 'code',
      id: 'cell-cut-list',
      language: 'python',
      source: 'list(range(80))',
      outputs: [],
      answers: [{ line: 1, kind: 'value', text: cut, type: 'list', size: 80 }],
    };
    render(<NotebookCodeCellRow {...rowProps(cell)} />);
    const answer = screen.getByTestId('notebook-cell-answer');
    expect(answer.textContent?.startsWith('list·80[0, 1, 2')).toBe(true);
  });

  it('answers a write with its row count in the number tone', () => {
    const cell: NotebookCodeCellV1 = {
      kind: 'code',
      id: 'cell-sql-write',
      language: 'sql',
      source: 'DELETE FROM orders WHERE total = 0;',
      outputs: [],
      answers: [{ line: 1, kind: 'value', type: 'rows', text: '3' }],
    };
    render(<NotebookCodeCellRow {...rowProps(cell)} />);
    const answer = screen.getByTestId('notebook-cell-answer');
    expect(answer.textContent).toBe('rows3');
    expect(within(answer).getByTestId('answer-object-value').dataset.tone).toBe('number');
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
    for (const answer of screen.getAllByTestId('answer-object')) expect(answer.hasAttribute('data-muted')).toBe(true);
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

  it('dates stale answers on their last line with the run they came from', async () => {
    const { rerender } = render(<NotebookCodeCellRow {...rowProps(pythonCell, 'stale', 3)} />);
    const answers = screen.getAllByTestId('notebook-cell-answer');
    const dated = screen.getByTestId('notebook-cell-answer-dated');
    expect(answers.at(-1)!.contains(dated)).toBe(true);
    expect(dated.textContent).toBe('from run 3 · may be out of date');
    rerender(<NotebookCodeCellRow {...rowProps(pythonCell, 'stale', null)} />);
    expect(screen.getByTestId('notebook-cell-answer-dated').textContent).toBe('may be out of date');
    await i18next.changeLanguage('es');
    rerender(<NotebookCodeCellRow {...rowProps(pythonCell, 'stale', 3)} />);
    expect(screen.getByTestId('notebook-cell-answer-dated').textContent).toBe(
      'de la ejecución 3 · puede estar desactualizado'
    );
    rerender(<NotebookCodeCellRow {...rowProps(pythonCell, 'ok', 3)} />);
    expect(screen.queryByTestId('notebook-cell-answer-dated')).toBeNull();
  });

  it('dates a stale query table below the table', () => {
    const cell: NotebookCodeCellV1 = {
      kind: 'code',
      id: 'cell-sql-stale',
      language: 'sql',
      source: 'SELECT city, share\nFROM by_city',
      outputs: [{ kind: 'text', stream: 'stdout', text: JSON.stringify([{ city: 'Cali', share: 1 }, { city: 'Bogotá', share: 2 }]) }],
      answers: [{ line: 1, kind: 'result', text: '', rows: 2, columns: 2 }],
    };
    render(<NotebookCodeCellRow {...rowProps(cell, 'stale', 2)} />);
    const dated = screen.getByTestId('notebook-cell-answer-dated');
    expect(screen.getByTestId('notebook-cell-answer').contains(dated)).toBe(false);
    expect(screen.getByTestId('notebook-cell-answer').style.gridRow).toBe('1 / 4');
    expect((dated.parentElement as HTMLElement).style.gridRow).toBe('4');
  });

  it('offers the run-and-move-on key on the last code line of a cell that never ran', async () => {
    const cell: NotebookCodeCellV1 = {
      kind: 'code',
      id: 'cell-js',
      language: 'javascript',
      source: "const usd = n => n.toFixed(2);\nusd(818294.4)\n\n",
      outputs: [],
    };
    const { rerender } = render(<NotebookCodeCellRow {...rowProps(cell, 'idle', null)} />);
    const hint = screen.getByTestId('notebook-cell-run-hint');
    expect(hint.style.gridRow).toBe('2');
    expect(hint.textContent).toBe('⇧↵run and move on');
    expect(hint.querySelector('kbd')!.getAttribute('aria-label')).toBe('Shift+Enter');
    const leaders = screen.getAllByTestId('notebook-cell-answer-leader');
    expect(leaders).toHaveLength(1);
    expect(leaders[0]!.style.left).toBe('calc(13ch + 22px)');
    // The margin says it never ran; the header does not repeat it.
    expect(screen.queryByTestId('notebook-code-cell-status')).toBeNull();
    await i18next.changeLanguage('es');
    rerender(<NotebookCodeCellRow {...rowProps(cell, 'idle', null)} />);
    expect(screen.getByTestId('notebook-cell-run-hint').textContent).toBe('⇧↵ejecuta y avanza');
    rerender(<NotebookCodeCellRow {...rowProps({ ...cell, source: '  \n' }, 'idle', null)} />);
    expect(screen.queryByTestId('notebook-cell-run-hint')).toBeNull();
    rerender(<NotebookCodeCellRow {...rowProps(cell, 'running', null)} />);
    expect(screen.queryByTestId('notebook-cell-run-hint')).toBeNull();
    // A run that left nothing on screen still ran: no hint, and the header keeps its status.
    rerender(<NotebookCodeCellRow {...rowProps(cell, 'idle', 2)} />);
    expect(screen.queryByTestId('notebook-cell-run-hint')).toBeNull();
    expect(screen.getByTestId('notebook-code-cell-status').dataset.status).toBe('idle');
  });

  it('runs from a quiet icon button, and names the replay on a stale cell', () => {
    const { rerender } = render(<NotebookCodeCellRow {...rowProps(pythonCell)} />);
    const run = screen.getByTestId('notebook-code-cell-run');
    expect(run.getAttribute('aria-label')).toBe('Run cell');
    expect(run.textContent).toBe('');
    rerender(<NotebookCodeCellRow {...rowProps(pythonCell, 'stale')} />);
    // The same element: a click that blurs an editor and stales this cell still lands.
    expect(screen.getByTestId('notebook-code-cell-run')).toBe(run);
    expect(run.textContent).toBe('Refresh cell');
    expect(run.getAttribute('aria-label')).toBeNull();
    expect(run.dataset.action).toBe('refresh');
  });

  it('keeps Run on a stale cell that runs in place', () => {
    const { rerender } = render(<NotebookCodeCellRow {...rowProps(pythonCell)} />);
    const run = screen.getByTestId('notebook-code-cell-run');
    rerender(<NotebookCodeCellRow {...rowProps(pythonCell, 'stale')} runsInPlace />);
    expect(screen.getByTestId('notebook-code-cell-run')).toBe(run);
    expect(run.dataset.action).toBe('run');
    expect(run.getAttribute('aria-label')).toBe('Run cell');
    rerender(<NotebookCodeCellRow {...rowProps(pythonCell, 'stale')} />);
    expect(run.dataset.action).toBe('refresh');
  });

  it('heads a plain output with the run time as its numeral and drops it from the cell badge', () => {
    const { answers: _answers, ...cell } = pythonCell;
    render(<NotebookCodeCellRow {...rowProps(cell)} durationMs={1240} />);
    const header = screen.getByTestId('result-header');
    expect(header.dataset.density).toBe('compact');
    expect(within(header).getByTestId('result-header-workspace').textContent).toBe('CODE');
    expect(screen.getByTestId('notebook-code-cell-output-latency').textContent).toBe('1.24s');
    expect(header.textContent).toContain('1 line');
    expect(screen.getByTestId('notebook-code-cell-status').textContent).toBe('Ok');
  });

  it('keeps the time on the cell badge while answers replace the output header', () => {
    render(<NotebookCodeCellRow {...rowProps(pythonCell)} durationMs={12.5} />);
    expect(screen.queryByTestId('result-header')).toBeNull();
    expect(screen.getByTestId('notebook-code-cell-status').textContent).toBe('Ok · 13 ms');
  });

  it('lets the last answer wrap into the free lines below it', () => {
    render(<NotebookCodeCellRow {...rowProps(pythonCell, 'stale')} />);
    const answers = screen.getAllByTestId('notebook-cell-answer');
    expect(answers.map(answer => answer.dataset.wrap)).toEqual([undefined, undefined, 'true']);
    expect(answers[2]!.style.gridRow).toBe('4 / 6');
    expect(answers[2]!.style.height).toBe('');
    expect(answers[1]!.style.height).not.toBe('');
    expect(within(answers[2]!).getByTestId('notebook-cell-answer-dated').textContent).toBe('from run 4 · may be out of date');
  });
});
