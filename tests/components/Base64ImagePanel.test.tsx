/**
 * RL-071 — Base64 Image panel tests. The pure helper is covered in
 * tests/utils/base64Image.test.ts, so this suite focuses on wiring:
 * mode toggle, file-input encode path, pasted-data-URI decode path,
 * error banners, preview rendering, ES locale.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';
import { DeveloperUtilitiesModal } from '../../src/renderer/components/DeveloperUtilities/DeveloperUtilitiesModal';
import { BASE64_IMAGE_MAX_BYTES } from '../../src/renderer/utils/base64Image';

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

const ONE_BY_ONE_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

describe('Base64ImagePanel', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('renders the Encode form by default with a dropzone and the empty preview', () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="base64-image" />);

    expect((screen.getByTestId('base64-image-mode') as HTMLSelectElement).value).toBe('encode');
    expect(screen.getByTestId('base64-image-dropzone')).toBeTruthy();
    // Empty state message for the preview column.
    expect(screen.getByText(/Drop or pick an image/)).toBeTruthy();
  });

  it('encodes an uploaded PNG into a data-URI with a preview and metadata', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="base64-image" />);

    const file = new File([ONE_BY_ONE_PNG], 'pixel.png', { type: 'image/png' });
    const input = screen.getByTestId('base64-image-file-input') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() => {
      const output = screen.getByTestId('base64-image-encode-output') as HTMLTextAreaElement;
      expect(output.value.startsWith('data:image/png;base64,')).toBe(true);
    });

    const preview = screen.getByTestId('base64-image-preview') as HTMLImageElement;
    expect(preview.src.startsWith('data:image/png;base64,')).toBe(true);
    expect(screen.getByTestId('base64-image-metadata').textContent).toContain('image/png');
  });

  it('surfaces the not-image error when a non-image file is dropped in encode mode', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="base64-image" />);

    const file = new File(['hello'], 'greeting.txt', { type: 'text/plain' });
    const input = screen.getByTestId('base64-image-file-input') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() => {
      const banner = screen.getByTestId('base64-image-encode-error');
      expect(banner.textContent).toMatch(/Not an image file/);
      expect(banner.textContent).toContain('text/plain');
    });
  });

  it('decodes a pasted PNG data-URI and renders the preview + metadata', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="base64-image" />);

    await user.selectOptions(screen.getByTestId('base64-image-mode'), 'decode');

    const textarea = screen.getByTestId('base64-image-decode-input') as HTMLTextAreaElement;
    const dataUri =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    fireEvent.change(textarea, { target: { value: dataUri } });

    await waitFor(() => {
      const preview = screen.getByTestId('base64-image-preview') as HTMLImageElement;
      expect(preview.src).toBe(dataUri);
    });
    expect(screen.getByTestId('base64-image-metadata').textContent).toContain('image/png');
  });

  it('shows the invalid-uri error when decode input is not a data URI', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="base64-image" />);

    await user.selectOptions(screen.getByTestId('base64-image-mode'), 'decode');

    const textarea = screen.getByTestId('base64-image-decode-input') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'https://example.com/image.png' } });

    await waitFor(() => {
      const banner = screen.getByTestId('base64-image-decode-error');
      expect(banner.textContent).toMatch(/Does not look like a data-URI/);
    });
    // No preview rendered for the error case.
    expect(screen.queryByTestId('base64-image-preview')).toBeNull();
  });

  it('shows the not-image error when decode input points to a non-image MIME', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="base64-image" />);

    await user.selectOptions(screen.getByTestId('base64-image-mode'), 'decode');

    const textarea = screen.getByTestId('base64-image-decode-input') as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: 'data:text/plain;base64,aGVsbG8=' },
    });

    await waitFor(() => {
      const banner = screen.getByTestId('base64-image-decode-error');
      expect(banner.textContent).toMatch(/not an image/);
      expect(banner.textContent).toContain('text/plain');
    });
  });

  it('rejects oversized pasted data-URIs before rendering a preview', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="base64-image" />);

    await user.selectOptions(screen.getByTestId('base64-image-mode'), 'decode');

    const textarea = screen.getByTestId('base64-image-decode-input') as HTMLTextAreaElement;
    const encodedLength = Math.ceil((BASE64_IMAGE_MAX_BYTES + 1) / 3) * 4;
    fireEvent.change(textarea, {
      target: { value: `data:image/png;base64,${'A'.repeat(encodedLength)}` },
    });

    await waitFor(() => {
      const banner = screen.getByTestId('base64-image-decode-error');
      expect(banner.textContent).toMatch(/caps previews/i);
    });
    expect(screen.queryByTestId('base64-image-preview')).toBeNull();
  });

  it('localizes the panel title to Spanish when the locale switches', async () => {
    await i18next.changeLanguage('es');
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="base64-image" />);

    expect(
      screen.getByRole('heading', { level: 3, name: /Codificar \/ decodificar imagen Base64/ }),
    ).toBeTruthy();
  });
});
