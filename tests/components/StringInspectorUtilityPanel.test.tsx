/**
 * internal — String Inspector panel tests. The pure helper is covered in
 * tests/utils/stringInspector.test.ts, so this suite only checks wiring:
 * the summary cards reflect live counts, warnings render per kind, the
 * character table shows rows with category data-attributes, and Spanish
 * copy resolves.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';
import { DeveloperUtilitiesModal } from '../../src/renderer/components/DeveloperUtilities/DeveloperUtilitiesModal';

vi.mock('../../src/renderer/components/ui/chrome', () => ({
  IconButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  OverlayBackdrop: ({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) => (
    <div onClick={onClose}>{children}</div>
  ),
  OverlayCard: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}));

describe('StringInspectorPanel', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('renders summary cards and a zero-width warning for the seeded input', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="string-inspector" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    // Seeded input is 'hello\u200Bworld' → 11 grapheme code points.
    expect(screen.getByTestId('string-inspector-graphemes').textContent).toBe('11');
    // UTF-16 units: 'hello' (5) + '\u200B' (1) + 'world' (5) = 11.
    expect(screen.getByTestId('string-inspector-utf16').textContent).toBe('11');

    // Zero-width warning is present.
    expect(screen.getByTestId('string-inspector-warning-zero-width')).toBeTruthy();
  });

  it('updates the counts live as the user types more characters', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="string-inspector" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const input = screen.getByTestId('string-inspector-input') as HTMLTextAreaElement;
    await user.clear(input);
    await user.type(input, 'abc');

    expect(screen.getByTestId('string-inspector-graphemes').textContent).toBe('3');
    expect(screen.getByTestId('string-inspector-utf8').textContent).toBe('3');
  });

  it('renders a bidi warning for a right-to-left override and tags the row accordingly', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="string-inspector" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const input = screen.getByTestId('string-inspector-input') as HTMLTextAreaElement;
    await user.clear(input);
    await user.type(input, 'a\u202Eb');

    expect(screen.getByTestId('string-inspector-warning-bidi-control')).toBeTruthy();
    const bidiRow = screen
      .getAllByTestId('string-inspector-row')
      .find((row) => row.getAttribute('data-category') === 'bidi');
    expect(bidiRow).toBeTruthy();
  });

  it('dismisses the warnings section entirely when the input is clean', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="string-inspector" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const input = screen.getByTestId('string-inspector-input') as HTMLTextAreaElement;
    await user.clear(input);
    await user.type(input, 'clean text');

    expect(screen.queryByTestId('string-inspector-warnings')).toBeNull();
  });

  it('localizes the panel and column headers to Spanish', async () => {
    await i18next.changeLanguage('es');
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="string-inspector" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    expect(screen.getByText('Grafemas')).toBeTruthy();
    expect(screen.getByText('Unidades UTF-16')).toBeTruthy();
    expect(screen.getByText('Bytes UTF-8')).toBeTruthy();
    // The category column and warnings panel heading are the two most
    // obvious localized labels inside the panel body.
    expect(screen.getByText('Categoría')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Advertencias' })).toBeTruthy();
  });
});
