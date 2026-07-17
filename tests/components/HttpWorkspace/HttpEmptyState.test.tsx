import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HttpEmptyState } from '../../../src/renderer/components/HttpWorkspace/HttpEmptyState';

describe('HttpEmptyState (SR-38)', () => {
  it('renders the title, body, and a primary New request CTA', () => {
    render(<HttpEmptyState onCreate={vi.fn()} />);
    expect(screen.getByText('No request selected')).toBeTruthy();
    expect(
      screen.getByText(
        'Create your first HTTP request to send it and see the response inline.'
      )
    ).toBeTruthy();
    expect(screen.getByTestId('http-workspace-empty-create')).toBeTruthy();
  });

  it('invokes onCreate when the New request CTA is clicked', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<HttpEmptyState onCreate={onCreate} />);

    await user.click(screen.getByTestId('http-workspace-empty-create'));

    expect(onCreate).toHaveBeenCalledOnce();
  });

  it('surfaces the import discovery hint with the resolved shortcut', () => {
    render(<HttpEmptyState onCreate={vi.fn()} />);
    const hint = screen.getByTestId('http-workspace-empty-import-hint');
    expect(hint).toBeTruthy();
    // The hint names the Postman/cURL import path and carries a rendered
    // key-combo glyph (a <kbd>) resolved from the shortcut catalog.
    expect(hint.textContent).toContain('Postman');
    expect(hint.querySelector('kbd')).toBeTruthy();
  });
});
