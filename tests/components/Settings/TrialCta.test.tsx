import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TrialCta } from '../../../src/renderer/components/Settings/TrialCta';

// A malformed email is rejected by the client-side guard BEFORE any
// network call, so these a11y assertions need no service mock.
vi.mock('../../../src/renderer/services/trialServer', () => ({
  startTrial: vi.fn(),
}));

describe('TrialCta email validation', () => {
  it('flags a malformed email with aria-invalid and an inline error', async () => {
    const user = userEvent.setup();
    render(<TrialCta />);

    const input = screen.getByTestId('trial-email-input');
    await user.type(input, 'not-an-email');
    await user.click(screen.getByTestId('trial-start'));

    expect(input.getAttribute('aria-invalid')).toBe('true');
    const error = screen.getByTestId('trial-email-error');
    expect(error).toBeTruthy();
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
  });

  it('clears the error state as soon as the field is edited', async () => {
    const user = userEvent.setup();
    render(<TrialCta />);

    const input = screen.getByTestId('trial-email-input');
    await user.type(input, 'bad');
    await user.click(screen.getByTestId('trial-start'));
    expect(input.getAttribute('aria-invalid')).toBe('true');

    await user.type(input, 'a@b.co');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(screen.queryByTestId('trial-email-error')).toBeNull();
  });
});
