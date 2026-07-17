import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HttpAssertionsTab } from '../../../src/renderer/components/HttpWorkspace/HttpAssertionsTab';
import { createBlankAssertion } from '../../../src/shared/httpWorkspace';

describe('HttpAssertionsTab (SR-27)', () => {
  it('shows the empty state and adds a row', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(
      <HttpAssertionsTab
        assertions={[]}
        onAdd={onAdd}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(screen.getByTestId('http-request-editor-assert-empty')).toBeTruthy();
    await user.click(screen.getByTestId('http-request-editor-assert-add'));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('renders a row and edits the comparator', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <HttpAssertionsTab
        assertions={[{ ...createBlankAssertion(), id: 'a1' }]}
        onAdd={vi.fn()}
        onUpdate={onUpdate}
        onRemove={vi.fn()}
      />
    );
    await user.selectOptions(
      screen.getByTestId('http-request-editor-assert-comparator'),
      'contains'
    );
    expect(onUpdate).toHaveBeenCalledWith(0, { comparator: 'contains' });
  });

  it('disables the path input for status and response-time sources', () => {
    render(
      <HttpAssertionsTab
        assertions={[{ ...createBlankAssertion(), id: 'a1', source: 'status' }]}
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(
      (screen.getByTestId('http-request-editor-assert-path') as HTMLInputElement).disabled
    ).toBe(true);
  });

  it('disables the expected input for exists / not-exists', () => {
    render(
      <HttpAssertionsTab
        assertions={[
          { ...createBlankAssertion(), id: 'a1', comparator: 'exists' },
        ]}
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(
      (screen.getByTestId('http-request-editor-assert-expected') as HTMLInputElement)
        .disabled
    ).toBe(true);
  });
});
