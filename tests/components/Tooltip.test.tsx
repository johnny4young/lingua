import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Tooltip } from '../../src/renderer/components/ui/chrome';

describe('Tooltip', () => {
  it('shows and hides tooltip content on hover and focus', async () => {
    const user = userEvent.setup();

    render(
      <Tooltip content="Open file">
        <button type="button">Files</button>
      </Tooltip>
    );

    const button = screen.getByRole('button', { name: 'Files' });

    expect(screen.queryByRole('tooltip')).toBeNull();

    await user.hover(button);
    expect(screen.getByRole('tooltip').textContent).toContain('Open file');

    await user.unhover(button);
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).toBeNull();
    });

    await user.tab();
    expect(screen.getByRole('tooltip').textContent).toContain('Open file');

    await user.tab();
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).toBeNull();
    });
  });
});
