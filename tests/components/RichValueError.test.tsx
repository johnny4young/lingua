import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ScopeValueError } from '../../src/shared/scopeSnapshot';
import { RichValueError } from '../../src/renderer/components/Console/RichValueError';

describe('RichValueError', () => {
  it('shows user frames before collapsed runtime details without internal links', () => {
    render(<RichValueError payload={{ kind: 'error', message: 'boom', stack: [
      { text: 'internal marker', file: 'worker.js', line: 12, provenance: 'runtime' },
      { text: 'user marker', line: 3, column: 7, provenance: 'user' },
    ] }} />);
    const details = screen.getByTestId('console-rich-error-runtime');
    expect(details.hasAttribute('open')).toBe(false);
    expect(screen.getByText('user marker').closest('details')).toBeNull();
    expect(screen.getByText('internal marker').closest('details')).toBe(details);
    expect(within(details).queryByRole('button', { hidden: true })).toBeNull();
    fireEvent.click(details.querySelector('summary')!);
    // Native details toggling is exercised by browser E2E; jsdom supplies structure only.
    expect(details.previousElementSibling?.contains(screen.getByText('user marker'))).toBe(true);
  });

  it('retains the source-frame menu target after partitioning', () => {
    render(<RichValueError payload={{ kind: 'error', message: 'menu', stack: [
      { text: 'runtime first', provenance: 'runtime' },
      { text: 'external user', file: 'app.js', line: 4 },
    ] }} />);
    fireEvent.contextMenu(screen.getByText('external user'));
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    expect((items[0] as HTMLButtonElement).disabled).toBe(false);
    expect((items[1] as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders Python cause-chain markers as non-clickable list separators', () => {
    const payload: ScopeValueError = {
      kind: 'error',
      message: 'RuntimeError: outer',
      stack: [
        {
          text: 'File "<stdin>", line 1, in <module>',
          file: '<stdin>',
          line: 1,
        },
        {
          text: 'The above exception was the direct cause of the following exception:',
          causedBy: 'cause',
        },
      ],
    };

    render(<RichValueError payload={payload} language="python" />);

    const separator = screen.getByTestId('console-rich-error-frame-causedby');
    expect(separator.getAttribute('data-causedby')).toBe('cause');
    expect(separator.getAttribute('role')).toBe('none');
    expect(separator.textContent).toContain('direct cause');
    expect(within(separator).queryByRole('button')).toBeNull();
  });
});
