import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EducationCta } from '../../../src/renderer/components/Settings/EducationCta';

vi.mock('../../../src/renderer/services/educationServer', () => ({
  startEducation: vi.fn(),
}));

describe('EducationCta email validation (SR-39)', () => {
  it('flags a malformed email with aria-invalid and an inline error', async () => {
    const user = userEvent.setup();
    render(<EducationCta />);

    const input = screen.getByTestId('education-email-input');
    await user.type(input, 'student');
    await user.click(screen.getByTestId('education-start'));

    expect(input.getAttribute('aria-invalid')).toBe('true');
    const error = screen.getByTestId('education-email-error');
    expect(error).toBeTruthy();
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
  });

  it('clears the error state as soon as the field is edited', async () => {
    const user = userEvent.setup();
    render(<EducationCta />);

    const input = screen.getByTestId('education-email-input');
    await user.type(input, 'nope');
    await user.click(screen.getByTestId('education-start'));
    expect(input.getAttribute('aria-invalid')).toBe('true');

    await user.type(input, 'a@school.edu');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(screen.queryByTestId('education-email-error')).toBeNull();
  });
});
