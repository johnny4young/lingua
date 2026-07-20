/**
 * implementation (Monaco cells) — NotebookCellEditor coverage.
 *
 * Pins the mount-virtualization contract (static colorized view until
 * edited; a live Monaco editor only on the editing cell, so a multi-cell
 * notebook never mounts more than one), the run / Esc keybind forwarding,
 * the plain-text colorize fallback, and the implementation note mount telemetry.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@monaco-editor/react', async () => {
  const m = await import('../../__fixtures__/monacoEditorMock');
  return m.makeMonacoEditorMock();
});
vi.mock('../../../src/renderer/utils/telemetry', () => ({
  trackEvent: vi.fn(),
}));

import { initI18n } from '../../../src/renderer/i18n';
import { NotebookCellEditor } from '../../../src/renderer/components/Notebook/NotebookCellEditor';
import { trackEvent } from '../../../src/renderer/utils/telemetry';
import {
  cellMockHarness,
  resetMonacoCellHarness,
  RUN_IN_PLACE_CHORD,
  RUN_ADVANCE_CHORD,
  RUN_INSERT_CHORD,
  ESCAPE_CHORD,
} from '../../__fixtures__/monacoEditorMock';

type EditorProps = Parameters<typeof NotebookCellEditor>[0];

function props(overrides: Partial<EditorProps> = {}): EditorProps {
  return {
    cellId: 'cell-a',
    language: 'javascript',
    value: 'const x = 1;',
    editing: false,
    disabled: false,
    ariaLabel: 'Code cell editor',
    placeholder: 'Write code',
    onChange: vi.fn(),
    onRequestEdit: vi.fn(),
    onBlur: vi.fn(),
    onRunInPlace: vi.fn(),
    onRunAdvance: vi.fn(),
    onRunInsertBelow: vi.fn(),
    onEscape: vi.fn(),
    ...overrides,
  };
}

describe('NotebookCellEditor', () => {
  beforeAll(async () => {
    await initI18n('en');
  });
  beforeEach(() => {
    resetMonacoCellHarness();
    vi.mocked(trackEvent).mockClear();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders a static view and mounts no Monaco editor when not editing', () => {
    render(<NotebookCellEditor {...props({ editing: false })} />);
    expect(screen.getByTestId('notebook-code-cell-static')).toBeTruthy();
    expect(screen.queryByTestId('notebook-code-cell-source')).toBeNull();
    expect(cellMockHarness.mountCount).toBe(0);
  });

  it('shows the source as plain text in the static view (colorize fallback)', () => {
    render(
      <NotebookCellEditor {...props({ editing: false, value: 'const answer = 42;' })} />
    );
    expect(screen.getByTestId('notebook-code-cell-static').textContent).toContain(
      'const answer = 42;'
    );
  });

  it('shows the placeholder in the static view when the cell is empty', () => {
    render(
      <NotebookCellEditor
        {...props({ editing: false, value: '', placeholder: 'Write JS here' })}
      />
    );
    expect(screen.getByTestId('notebook-code-cell-static').textContent).toContain(
      'Write JS here'
    );
  });

  it('mounts a Monaco editor when editing and fires the mount telemetry (implementation note)', () => {
    render(<NotebookCellEditor {...props({ editing: true, language: 'typescript' })} />);
    expect(screen.getByTestId('notebook-code-cell-source')).toBeTruthy();
    expect(cellMockHarness.mountCount).toBe(1);
    expect(trackEvent).toHaveBeenCalledWith('notebook.cell_editor_mounted', {
      language: 'typescript',
    });
  });

  it('requests edit when the static view is clicked', () => {
    const onRequestEdit = vi.fn();
    render(<NotebookCellEditor {...props({ editing: false, onRequestEdit })} />);
    fireEvent.mouseDown(screen.getByTestId('notebook-code-cell-static'));
    expect(onRequestEdit).toHaveBeenCalledTimes(1);
  });

  it('requests edit when the static view is keyboard-activated', () => {
    const onRequestEdit = vi.fn();
    render(<NotebookCellEditor {...props({ editing: false, onRequestEdit })} />);

    const staticView = screen.getByTestId('notebook-code-cell-static');
    fireEvent.keyDown(staticView, { key: 'Enter' });
    fireEvent.keyDown(staticView, { key: ' ' });

    expect(onRequestEdit).toHaveBeenCalledTimes(2);
  });

  it('forwards the Jupyter run + escape keybinds from the Monaco commands', () => {
    const onRunInPlace = vi.fn();
    const onRunAdvance = vi.fn();
    const onRunInsertBelow = vi.fn();
    const onEscape = vi.fn();
    render(
      <NotebookCellEditor
        {...props({ editing: true, onRunInPlace, onRunAdvance, onRunInsertBelow, onEscape })}
      />
    );
    act(() => cellMockHarness.commands.get(RUN_IN_PLACE_CHORD)?.());
    act(() => cellMockHarness.commands.get(RUN_ADVANCE_CHORD)?.());
    act(() => cellMockHarness.commands.get(RUN_INSERT_CHORD)?.());
    act(() => cellMockHarness.commands.get(ESCAPE_CHORD)?.());
    expect(onRunInPlace).toHaveBeenCalledTimes(1);
    expect(onRunAdvance).toHaveBeenCalledTimes(1);
    expect(onRunInsertBelow).toHaveBeenCalledTimes(1);
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('passes Monaco edits through onChange', () => {
    const onChange = vi.fn();
    render(<NotebookCellEditor {...props({ editing: true, onChange })} />);
    fireEvent.change(screen.getByTestId('notebook-code-cell-source'), {
      target: { value: 'next()' },
    });
    expect(onChange).toHaveBeenCalledWith('next()');
  });

  it('keeps at most one live Monaco editor across cells (mount-virtualization)', () => {
    render(
      <div>
        <NotebookCellEditor {...props({ cellId: 'a', editing: false })} />
        <NotebookCellEditor {...props({ cellId: 'b', editing: true })} />
        <NotebookCellEditor {...props({ cellId: 'c', editing: false })} />
      </div>
    );
    expect(screen.queryAllByTestId('notebook-code-cell-source')).toHaveLength(1);
    expect(screen.queryAllByTestId('notebook-code-cell-static')).toHaveLength(2);
  });
});
