import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ScopeValueError } from '../../src/shared/scopeSnapshot';
import { RichValueError } from '../../src/renderer/components/Console/RichValueError';

describe('RichValueError', () => {
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
