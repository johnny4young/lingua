/**
 * RL-072 — QR Code panel tests. The pure helper is covered in
 * tests/utils/qrCode.test.ts, so this suite only checks wiring:
 * the live preview image renders, the level selector re-triggers the
 * async regen, empty payload surfaces the placeholder, and Spanish
 * copy resolves.
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
  OverlayBackdrop: ({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) => (
    <div onClick={onClose}>{children}</div>
  ),
  OverlayCard: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}));

describe('QrCodePanel', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('renders a PNG data-url preview for the seeded payload', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="qr-code" />);

    const image = (await screen.findByTestId('qr-code-image')) as HTMLImageElement;
    expect(image.src.startsWith('data:image/png;base64,')).toBe(true);
    // Alt text interpolates the payload so screen readers know what scans to.
    expect(image.alt).toContain('linguacode.dev');
  });

  it('regenerates the preview when the correction level changes', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="qr-code" />);

    const firstImage = (await screen.findByTestId('qr-code-image')) as HTMLImageElement;
    const firstSrc = firstImage.src;

    await user.selectOptions(screen.getByTestId('qr-code-level'), 'H');

    await waitFor(() => {
      const nextImage = screen.getByTestId('qr-code-image') as HTMLImageElement;
      expect(nextImage.src).not.toBe(firstSrc);
    });
  });

  it('shows the empty placeholder and hides the image when the payload is cleared', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="qr-code" />);

    // Wait for the seeded preview to render first.
    await screen.findByTestId('qr-code-image');

    const input = screen.getByTestId('qr-code-input') as HTMLTextAreaElement;
    await user.clear(input);

    await waitFor(() => {
      expect(screen.queryByTestId('qr-code-image')).toBeNull();
      expect(screen.getByText('Paste a payload to generate a QR code.')).toBeTruthy();
    });
  });

  it('shows the too-long error with the capacity ceiling for oversized payloads', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="qr-code" />);

    await screen.findByTestId('qr-code-image');

    // Switch to H so we hit the smallest ceiling (1273 bytes), then
    // programmatically set a payload that definitely exceeds it. We
    // reach for fireEvent.change here because `user.type`/`user.paste`
    // would otherwise iterate char-by-char over 1500 characters and
    // slow the test run down by an order of magnitude.
    await user.selectOptions(screen.getByTestId('qr-code-level'), 'H');
    const input = screen.getByTestId('qr-code-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'x'.repeat(1500) } });

    await waitFor(() => {
      expect(screen.queryByTestId('qr-code-image')).toBeNull();
      // The capacity hint ("Current level holds up to 1273 UTF-8 bytes…")
      // also mentions 1273, so scope on the error copy prefix.
      expect(screen.getByText(/Payload is larger than this correction level/)).toBeTruthy();
    });
  });

  it('localizes the panel headings and level labels to Spanish', async () => {
    await i18next.changeLanguage('es');
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="qr-code" />);

    expect(
      screen.getByRole('heading', { level: 3, name: 'Generar un código QR' })
    ).toBeTruthy();
    expect(screen.getByText('Vista previa')).toBeTruthy();
    const levelSelect = screen.getByTestId('qr-code-level') as HTMLSelectElement;
    const labels = Array.from(levelSelect.options).map((opt) => opt.textContent);
    expect(labels.some((label) => label && label.startsWith('Baja'))).toBe(true);
    expect(labels.some((label) => label && label.startsWith('Media'))).toBe(true);
    expect(labels.some((label) => label && label.startsWith('Alta'))).toBe(true);
  });
});
