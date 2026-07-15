/**
 * RL-043 Slice (Monaco cells) — code-cell edit-request handling.
 *
 * Reviewer regression lock: a command-mode "enter edit" request
 * (`editRequestNonce`) must open the cell's Monaco editor even while
 * ANOTHER cell is running. The parent passes `disabled = isAnyCellRunning`
 * (global), so Shift+Enter "run and advance" bumps the NEXT cell's nonce
 * while a different cell is mid-run; gating the edit-request effect on
 * `disabled` (or putting run-status in its deps) used to swallow that and
 * delay opening the next cell until the run finished. The editor mounts
 * read-only via the `disabled` prop, so opening mid-run is safe.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { initI18n } from '../../../src/renderer/i18n';
import { NotebookCodeCellRow } from '../../../src/renderer/components/Notebook/NotebookCodeCellRow';
import type { NotebookCodeCellV1 } from '../../../src/shared/notebook';
import {
  cellMockHarness,
  ESCAPE_CHORD,
  resetMonacoCellHarness,
} from '../../__fixtures__/monacoEditorMock';

vi.mock('@monaco-editor/react', async () => {
  const m = await import('../../__fixtures__/monacoEditorMock');
  return m.makeMonacoEditorMock();
});

function makeCell(overrides: Partial<NotebookCodeCellV1> = {}): NotebookCodeCellV1 {
  return { kind: 'code', id: 'cell-a', language: 'javascript', source: '1', outputs: [], ...overrides };
}

function rowProps(overrides: Record<string, unknown> = {}) {
  return {
    cell: makeCell(),
    cellIndex: 0,
    status: 'idle' as const,
    isActive: true,
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
    ...overrides,
  };
}

async function flushAnimationFrame(): Promise<void> {
  await act(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      })
  );
}

describe('NotebookCodeCellRow — edit-request handling', () => {
  beforeAll(async () => {
    await initI18n('en');
    await i18next.changeLanguage('en');
  });
  beforeEach(() => resetMonacoCellHarness());
  afterEach(() => vi.clearAllMocks());

  it('opens the editor on an edit request even while another cell is running', async () => {
    // disabled=true models isAnyCellRunning (a DIFFERENT cell is mid-run);
    // status stays idle because THIS cell is not the one running.
    const { rerender } = render(
      <NotebookCodeCellRow {...rowProps({ disabled: true, editRequestNonce: null })} />
    );
    expect(screen.queryByTestId('notebook-code-cell-source')).toBeNull();

    rerender(
      <NotebookCodeCellRow {...rowProps({ disabled: true, editRequestNonce: 1 })} />
    );

    // Synchronize with the deliberate rAF deferral instead of polling with
    // waitFor's one-second wall-clock budget. The full Linux suite can keep
    // the worker busy long enough for that budget to expire even though the
    // next frame still produces the correct UI.
    await flushAnimationFrame();
    expect(screen.queryByTestId('notebook-code-cell-source')).toBeTruthy();
  });

  it('does not re-open an escaped editor when the run status later settles (stable nonce)', async () => {
    // Enter edit via a request...
    const { rerender } = render(
      <NotebookCodeCellRow {...rowProps({ status: 'running', editRequestNonce: 7 })} />
    );
    await flushAnimationFrame();
    expect(screen.queryByTestId('notebook-code-cell-source')).toBeTruthy();

    // ...escape back to command mode (Monaco's Esc command -> the row drops
    // edit mode), so the static view returns.
    act(() => cellMockHarness.commands.get(ESCAPE_CHORD)?.());
    await waitFor(() =>
      expect(screen.queryByTestId('notebook-code-cell-static')).toBeTruthy()
    );

    // The run now settles (running -> ok) with the nonce UNCHANGED. Because
    // the effect depends only on the nonce, this must NOT re-open the cell the
    // user just escaped. (With run-status in the deps it would re-fire and
    // yank the user back into the editor.)
    rerender(
      <NotebookCodeCellRow {...rowProps({ status: 'ok', editRequestNonce: 7 })} />
    );
    expect(screen.queryByTestId('notebook-code-cell-source')).toBeNull();
  });
});
