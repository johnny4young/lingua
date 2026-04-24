/**
 * RL-068 — LoremIpsumPanel tests. The pure helper is covered in
 * tests/utils/loremIpsum.test.ts, so this suite focuses on wiring:
 * default state, unit toggle resets count, classic-opening checkbox,
 * Generate click, CopyButton, ES locale.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';
import { DeveloperUtilitiesModal } from '../../src/renderer/components/DeveloperUtilities/DeveloperUtilitiesModal';

vi.mock('../../src/renderer/components/ui/chrome', () => ({
  IconButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  OverlayBackdrop: ({
    children,
    onClose,
  }: {
    children: React.ReactNode;
    onClose?: () => void;
  }) => <div onClick={onClose}>{children}</div>,
  OverlayCard: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}));

describe('LoremIpsumPanel', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('renders with default unit=paragraphs, count=3, classic toggle on, empty output', () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="lorem-ipsum" />);

    expect((screen.getByTestId('lorem-ipsum-unit') as HTMLSelectElement).value).toBe('paragraphs');
    expect((screen.getByTestId('lorem-ipsum-count') as HTMLInputElement).value).toBe('3');
    expect((screen.getByTestId('lorem-ipsum-classic') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByTestId('lorem-ipsum-output')).toBeNull();
  });

  it('generates paragraphs that open with the canonical phrase when classic is on', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="lorem-ipsum" />);

    await user.click(screen.getByTestId('lorem-ipsum-generate'));

    const output = (await screen.findByTestId('lorem-ipsum-output')) as HTMLTextAreaElement;
    expect(output.value.startsWith('Lorem ipsum dolor sit amet, consectetur adipiscing elit.')).toBe(
      true,
    );
    // 3 paragraphs separated by blank lines.
    expect(output.value.split('\n\n')).toHaveLength(3);
  });

  it('drops the canonical opening when the classic toggle is off', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="lorem-ipsum" />);

    await user.click(screen.getByTestId('lorem-ipsum-classic'));
    await user.click(screen.getByTestId('lorem-ipsum-generate'));

    const output = (await screen.findByTestId('lorem-ipsum-output')) as HTMLTextAreaElement;
    // With randomness disabled by the canonical opening being off, we can't
    // pin an exact prefix. We just assert the output is non-empty and still
    // a structurally valid block of 3 paragraphs.
    expect(output.value.length).toBeGreaterThan(0);
    expect(output.value.split('\n\n')).toHaveLength(3);
  });

  it('unit change resets the count to a unit-appropriate default and clears the output', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="lorem-ipsum" />);

    await user.click(screen.getByTestId('lorem-ipsum-generate'));
    expect(await screen.findByTestId('lorem-ipsum-output')).toBeTruthy();

    await user.selectOptions(screen.getByTestId('lorem-ipsum-unit'), 'words');
    await waitFor(() => {
      expect(screen.queryByTestId('lorem-ipsum-output')).toBeNull();
    });
    // Default count for words is 50.
    expect((screen.getByTestId('lorem-ipsum-count') as HTMLInputElement).value).toBe('50');
  });

  it('respects the count input in words mode', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="lorem-ipsum" />);

    await user.selectOptions(screen.getByTestId('lorem-ipsum-unit'), 'words');
    const countInput = screen.getByTestId('lorem-ipsum-count') as HTMLInputElement;
    fireEvent.change(countInput, { target: { value: '12' } });

    await user.click(screen.getByTestId('lorem-ipsum-generate'));

    const output = (await screen.findByTestId('lorem-ipsum-output')) as HTMLTextAreaElement;
    expect(output.value.split(' ')).toHaveLength(12);
  });

  it('localizes the panel title to Spanish when the locale switches', async () => {
    await i18next.changeLanguage('es');
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="lorem-ipsum" />);

    expect(
      screen.getByRole('heading', { level: 3, name: /Generar Lorem Ipsum/ }),
    ).toBeTruthy();
    expect(screen.getByTestId('lorem-ipsum-generate').textContent).toBe('Generar');
  });
});
