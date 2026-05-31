/**
 * FASE 0 — Signal-Slate <EmptyState> render contract.
 *
 * Covers:
 *   - Title + description render from props.
 *   - The glyph slot renders the supplied icon.
 *   - The optional action slot renders only when provided, and a CTA
 *     inside it stays interactive.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState } from '../../src/renderer/components/ui/EmptyState';

describe('FASE 0 — <EmptyState>', () => {
  it('renders the title and description from props', () => {
    render(
      <EmptyState
        icon={<svg data-testid="glyph" />}
        title="No query yet"
        description="Write a statement and run it."
      />
    );
    expect(screen.getByText('No query yet')).toBeTruthy();
    expect(screen.getByText('Write a statement and run it.')).toBeTruthy();
  });

  it('renders the supplied icon in the glyph tile', () => {
    render(
      <EmptyState
        icon={<svg data-testid="glyph" />}
        title="Empty"
        description="Nothing here."
      />
    );
    expect(screen.getByTestId('glyph')).toBeTruthy();
  });

  it('does not render an action slot when no action is given', () => {
    const { container } = render(
      <EmptyState
        icon={<svg />}
        title="Empty"
        description="Nothing here."
      />
    );
    // The only button-like child would be inside the action slot.
    expect(container.querySelector('button')).toBeNull();
  });

  it('omits the description row entirely when description is null (title-only state)', () => {
    // FileTreeEmptyState passes description={null}; the row must not
    // render as a spurious empty <div> carrying its top margin.
    const { container } = render(
      <EmptyState icon={<svg />} title="No project open" description={null} />
    );
    expect(screen.getByText('No project open')).toBeTruthy();
    expect(container.querySelector('.text-fg-subtle')).toBeNull();
  });

  it('renders the action and keeps a CTA inside it clickable', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <EmptyState
        icon={<svg />}
        title="No query yet"
        description="Write a statement and run it."
        action={
          <button type="button" onClick={onClick}>
            New query
          </button>
        }
      />
    );
    const cta = screen.getByRole('button', { name: 'New query' });
    expect(cta).toBeTruthy();
    await user.click(cta);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
