/**
 * The code cell header: the language by name, the status as sentence-case
 * text with its unit, chips that wrap, and a narrow cell's layout hooks.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen, within } from '@testing-library/react';
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

const cell: NotebookCodeCellV1 = {
  kind: 'code',
  id: 'cell-py',
  language: 'python',
  source: 'over = [t for t in tickets if t > avg]\nlen(over) / len(tickets)',
  outputs: [],
  answers: [
    { line: 1, kind: 'value', text: '[151.2, 162.4, 171.05]', type: 'list', size: 3 },
    { line: 2, kind: 'value', text: '0.5', type: 'float' },
  ],
};

function rowProps(status: NotebookCellRunStatus = 'ok', source: NotebookCodeCellV1 = cell) {
  return {
    cell: source,
    cellIndex: 1,
    status,
    executionOrder: 3,
    isActive: false,
    canMoveUp: true,
    canMoveDown: true,
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

describe('NotebookCodeCellRow — header', () => {
  beforeAll(async () => {
    await initI18n('en');
  });
  afterEach(async () => {
    await i18next.changeLanguage('en');
  });

  it('reads the status as text with a lowercase unit', () => {
    const { rerender } = render(<NotebookCodeCellRow {...rowProps()} durationMs={38.4} />);
    const status = screen.getByTestId('notebook-code-cell-status');
    expect(status.textContent).toBe('Ok · 38 ms');
    expect(status.className).toBe('notebook-cell-status');
    expect(status.className).not.toMatch(/uppercase/u);
    expect(status.querySelector('.run-dot')!.getAttribute('data-run-dot')).toBe('ok');
    rerender(<NotebookCodeCellRow {...rowProps()} durationMs={1.24} />);
    expect(status.textContent).toBe('Ok · 1.2 ms');
    rerender(<NotebookCodeCellRow {...rowProps()} durationMs={1240} />);
    expect(status.textContent).toBe('Ok · 1.24 s');
  });

  it('marks a failed and a stale cell with the shared run dot', () => {
    const { rerender } = render(<NotebookCodeCellRow {...rowProps('error')} durationMs={16.8} />);
    const dot = () => screen.getByTestId('notebook-code-cell-status').querySelector('.run-dot')!;
    expect(dot().getAttribute('data-run-dot')).toBe('error');
    expect(screen.getByTestId('notebook-code-cell-status').textContent).toBe('Error · 17 ms');
    rerender(<NotebookCodeCellRow {...rowProps('stale')} durationMs={16.8} />);
    expect(dot().getAttribute('data-run-dot')).toBe('stale');
  });

  it('names the language beside its pill and keeps the cell number for assistive tech', async () => {
    render(<NotebookCodeCellRow {...rowProps()} />);
    const row = screen.getByTestId('notebook-code-cell-row');
    expect(screen.getByTestId('notebook-code-cell-language-name').textContent).toBe('Python');
    expect(row.getAttribute('aria-label')).toBe('Cell 2');
    expect(within(row.querySelector('header')!).queryByText('Cell 2')).toBeNull();
    await i18next.changeLanguage('es');
    render(<NotebookCodeCellRow {...rowProps()} />);
    expect(screen.getAllByTestId('notebook-code-cell-row')[1]!.getAttribute('aria-label')).toBe('Celda 2');
  });

  it('lets long makes and uses chips wrap instead of truncating', () => {
    render(
      <NotebookCodeCellRow
        {...rowProps()}
        varFlow={{ uses: ['tickets', 'avg'], produces: ['over_the_average_ticket_size'] }}
      />
    );
    for (const id of ['notebook-code-cell-produces', 'notebook-code-cell-uses']) {
      const chip = screen.getByTestId(id);
      expect(chip.className).toBe('notebook-cell-chip');
      expect(chip.parentElement!.className).toBe('notebook-cell-header-chips');
    }
    expect(screen.getByTestId('notebook-code-cell-uses').textContent).toBe('uses tickets, avg');
  });

  it('keeps the Refresh cell name on the button when a narrow cell hides its label', () => {
    render(<NotebookCodeCellRow {...rowProps('stale')} />);
    const refresh = screen.getByRole('button', { name: 'Refresh cell' });
    expect(refresh.dataset.action).toBe('refresh');
    expect(refresh.querySelector('.notebook-cell-refresh-label')!.textContent).toBe('Refresh cell');
  });

  it('marks a cell whose answers include a table so it stacks earlier', () => {
    const sql: NotebookCodeCellV1 = {
      kind: 'code',
      id: 'cell-sql',
      language: 'sql',
      source: 'SELECT city, revenue FROM by_city',
      outputs: [{ kind: 'text', stream: 'stdout', text: JSON.stringify([{ city: 'Cali', revenue: 1 }, { city: 'Bogotá', revenue: 2 }]) }],
      answers: [{ line: 1, kind: 'result', text: '', rows: 2, columns: 2 }],
    };
    const { container, rerender } = render(<NotebookCodeCellRow {...rowProps('ok', sql)} />);
    const body = container.querySelector('.notebook-cell-body') as HTMLElement;
    expect(body.dataset.answers).toBe('true');
    expect(body.dataset.table).toBe('true');
    rerender(<NotebookCodeCellRow {...rowProps()} />);
    expect((container.querySelector('.notebook-cell-body') as HTMLElement).dataset.table).toBeUndefined();
  });
});

describe('notebook answers stylesheet', () => {
  const css = readFileSync(
    path.resolve(__dirname, '../../../src/renderer/components/Notebook/notebookAnswers.css'),
    'utf8'
  );

  it('folds by the cell width, not the window width', () => {
    expect(css).toMatch(/\.notebook-cell-shell \{\s*container: notebook-cell \/ inline-size;/u);
    expect(css).toContain("@container notebook-cell (max-width: 720px) {\n  .notebook-cell-body[data-answers='true'] {");
    expect(css).toContain("@container notebook-cell (max-width: 960px) {\n  .notebook-cell-body[data-table='true'] {");
    expect(css).toMatch(/@container notebook-cell \(max-width: 560px\) \{[^@]*\.notebook-cell-refresh-label/u);
    // Bars size to the cell, never to the window.
    expect(css).not.toMatch(/\d+vw/u);
  });

  it('clamps wrapped answers to three lines', () => {
    expect(css.match(/-webkit-line-clamp: 3;/gu)).toHaveLength(3);
  });
});
