import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SqlConnectionBar } from '../../../src/renderer/components/SqlWorkspace/SqlConnectionBar';

describe('SqlConnectionBar', () => {
  it('names Local DuckDB on the pill and lists it first in the picker', async () => {
    const user = userEvent.setup();
    render(<SqlConnectionBar actions={<button type="button">Import data</button>} />);
    const pill = screen.getByTestId('sql-connection-pill');
    expect(pill.getAttribute('aria-label')).toBe('Connection: Local DuckDB');
    expect(pill.getAttribute('aria-haspopup')).toBe('listbox');
    await user.click(pill);
    expect(pill.getAttribute('aria-expanded')).toBe('true');
    const option = screen.getByTestId('sql-connection-option-local');
    expect(option.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('This device')).toBeTruthy();
  });

  it('filters the picker and closes on Escape, back on the pill', async () => {
    const user = userEvent.setup();
    render(<SqlConnectionBar />);
    await user.click(screen.getByTestId('sql-connection-pill'));
    await user.type(screen.getByTestId('sql-connection-search'), 'postgres');
    expect(screen.queryByTestId('sql-connection-option-local')).toBeNull();
    expect(screen.getByText('No connection matches.')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('sql-connection-picker')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('sql-connection-pill'));
  });

  it('moves from the search into the option with ArrowDown and returns to the pill on pick', async () => {
    const user = userEvent.setup();
    render(<SqlConnectionBar />);
    await user.click(screen.getByTestId('sql-connection-pill'));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByTestId('sql-connection-option-local'));
    await user.click(screen.getByTestId('sql-connection-option-local'));
    expect(screen.queryByTestId('sql-connection-picker')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('sql-connection-pill'));
  });
});
