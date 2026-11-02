import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ClipboardBanner } from '../../../src/renderer/components/DeveloperUtilities/ClipboardBanner';

describe('ClipboardBanner', () => {
  it('keeps one live region mounted while its text comes and goes', () => {
    const { rerender } = render(<ClipboardBanner kind={null} />);
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');
    rerender(<ClipboardBanner kind="jwt" />);
    expect(screen.getByRole('status')).toBe(region);
    expect(region.textContent).toBe('Clipboard looks like a JWT');
    rerender(<ClipboardBanner kind={null} />);
    expect(screen.getByRole('status')).toBe(region);
    expect(region.textContent).toBe('');
  });
});
