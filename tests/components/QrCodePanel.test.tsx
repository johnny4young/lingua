/**
 * internal — QR Code panel tests. The pure helper is covered in
 * tests/utils/qrCode.test.ts, so this suite only checks wiring:
 * the live preview image renders, the level selector re-triggers the
 * async regen, empty payload surfaces the placeholder, Spanish copy
 * resolves, and the folds (mode switch, decode dropzone, Copy as PNG,
 * SVG download, color picker + contrast guard, utilityOutputStore
 * registration) all behave end-to-end.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';
import { DeveloperUtilitiesModal } from '../../src/renderer/components/DeveloperUtilities/DeveloperUtilitiesModal';
import { useUtilityOutputStore } from '../../src/renderer/stores/utilityOutputStore';
import { decodeQrFromFile, type QrDecodeResult } from '../../src/renderer/utils/qrCode';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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

// Stub `decodeQrFromFile` so tests don't depend on jsdom's image
// decoding pipeline. The real helper has full coverage in
// tests/utils/qrCode.test.ts.
vi.mock('../../src/renderer/utils/qrCode', async () => {
  const actual = await vi.importActual<
    typeof import('../../src/renderer/utils/qrCode')
  >('../../src/renderer/utils/qrCode');
  return {
    ...actual,
    decodeQrFromFile: vi.fn(async (file: File | null) => {
      if (!file) return { ok: false, kind: 'empty' as const };
      if (file.name.includes('reject-not-found')) {
        return { ok: false, kind: 'no-qr-found' as const };
      }
      return { ok: true, value: 'https://decoded.example/lingua' };
    }),
  };
});

describe('QrCodePanel', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
    vi.mocked(decodeQrFromFile).mockImplementation(async (file: File | null) => {
      if (!file) return { ok: false, kind: 'empty' as const };
      if (file.name.includes('reject-not-found')) {
        return { ok: false, kind: 'no-qr-found' as const };
      }
      return { ok: true, value: 'https://decoded.example/lingua' };
    });
  });

  it('renders a PNG data-url preview for the seeded payload', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="qr-code" />);

    const image = (await screen.findByTestId(
      'qr-code-image',
      undefined,
      { timeout: 5000 }
    )) as HTMLImageElement;
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

  // ----------------------------------------------------------- implementation note: decode

  it('switches between generate and decode modes and renders the dropzone (implementation note)', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="qr-code" />);

    await screen.findByTestId('qr-code-image');

    await user.selectOptions(screen.getByTestId('qr-code-mode'), 'decode');
    expect(screen.getByTestId('qr-code-decode-dropzone')).toBeTruthy();
    // Generate-side controls are gone in decode mode.
    expect(screen.queryByTestId('qr-code-image')).toBeNull();
    expect(screen.queryByTestId('qr-code-input')).toBeNull();
  });

  it('decodes a dropped image file and renders the payload (implementation note)', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="qr-code" />);

    await screen.findByTestId('qr-code-image');
    await user.selectOptions(screen.getByTestId('qr-code-mode'), 'decode');

    const fileInput = screen.getByTestId('qr-code-decode-input') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], 'qr.png', { type: 'image/png' });
    await user.upload(fileInput, file);

    await waitFor(() => {
      const decoded = screen.getByTestId('qr-code-decoded-payload') as HTMLTextAreaElement;
      expect(decoded.value).toBe('https://decoded.example/lingua');
    });
  });

  it('renders a localized error when decoding fails (implementation note)', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="qr-code" />);

    await screen.findByTestId('qr-code-image');
    await user.selectOptions(screen.getByTestId('qr-code-mode'), 'decode');

    const fileInput = screen.getByTestId('qr-code-decode-input') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], 'reject-not-found.png', {
      type: 'image/png',
    });
    await user.upload(fileInput, file);

    // The error renders both inside the FileDropZone label (error state)
    // and inside the StatusMessage in the readout panel — both surface
    // the same localized copy. Assert at least one match is present.
    await waitFor(() => {
      expect(
        screen.getAllByText('No QR code found in this image.').length
      ).toBeGreaterThan(0);
    });
  });

  it('keeps the latest decode result when two uploads resolve out of order (implementation note)', async () => {
    const user = userEvent.setup();
    const first = deferred<QrDecodeResult>();
    const second = deferred<QrDecodeResult>();
    vi.mocked(decodeQrFromFile)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="qr-code" />);

    await screen.findByTestId('qr-code-image');
    await user.selectOptions(screen.getByTestId('qr-code-mode'), 'decode');

    const fileInput = screen.getByTestId('qr-code-decode-input') as HTMLInputElement;
    await user.upload(
      fileInput,
      new File([new Uint8Array([1])], 'first.png', { type: 'image/png' })
    );
    await user.upload(
      fileInput,
      new File([new Uint8Array([2])], 'second.png', { type: 'image/png' })
    );

    await act(async () => {
      second.resolve({ ok: true, value: 'newer decode' });
      await second.promise;
    });

    await waitFor(() => {
      const decoded = screen.getByTestId('qr-code-decoded-payload') as HTMLTextAreaElement;
      expect(decoded.value).toBe('newer decode');
    });

    await act(async () => {
      first.resolve({ ok: true, value: 'stale decode' });
      await first.promise;
    });

    const decoded = screen.getByTestId('qr-code-decoded-payload') as HTMLTextAreaElement;
    expect(decoded.value).toBe('newer decode');
  });

  // ------------------------------------------------ implementation note: high-contrast preset

  it('toggles the high-contrast preset and disables the color pickers (implementation note)', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="qr-code" />);

    await screen.findByTestId('qr-code-image');

    const dark = screen.getByTestId('qr-code-color-dark') as HTMLInputElement;
    const light = screen.getByTestId('qr-code-color-light') as HTMLInputElement;
    expect(dark.disabled).toBe(false);
    expect(light.disabled).toBe(false);

    await user.click(screen.getByTestId('qr-code-high-contrast'));

    expect(dark.disabled).toBe(true);
    expect(light.disabled).toBe(true);
    // Readouts force the pure-black/white preset values.
    expect(
      (screen.getByTestId('qr-code-color-dark-readout') as HTMLElement).textContent
    ).toBe('#000000');
    expect(
      (screen.getByTestId('qr-code-color-light-readout') as HTMLElement).textContent
    ).toBe('#FFFFFF');
  });

  // ----------------------------------------------- implementation note: copy as PNG

  it('flips the Copy-as-PNG label after a successful clipboard write (implementation note)', async () => {
    const user = userEvent.setup();
    type Clip = typeof navigator.clipboard | undefined;
    const original: Clip = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write: vi.fn(async () => undefined) },
    });
    class FakeClipboardItem {
      constructor(public readonly entries: Record<string, Blob>) {}
    }
    (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem =
      FakeClipboardItem as unknown as typeof ClipboardItem;

    try {
      render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="qr-code" />);
      await screen.findByTestId('qr-code-image');

      await user.click(screen.getByTestId('qr-code-copy-png'));

      await waitFor(() => {
        expect(screen.getByTestId('qr-code-copy-png').textContent).toBe(
          'Copied to clipboard'
        );
      });
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: original,
      });
    }
  });

  it('shows the unsupported label when the clipboard image API is missing (implementation note)', async () => {
    const user = userEvent.setup();
    type Clip = typeof navigator.clipboard | undefined;
    const original: Clip = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    delete (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;

    try {
      render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="qr-code" />);
      await screen.findByTestId('qr-code-image');

      await user.click(screen.getByTestId('qr-code-copy-png'));

      await waitFor(() => {
        expect(screen.getByTestId('qr-code-copy-png').textContent).toContain(
          'not supported'
        );
      });
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: original,
      });
    }
  });

  // ------------------------------- implementation note: color picker + WCAG contrast guard

  it('shows the contrast warning when colors fail the WCAG-AA threshold (implementation note)', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="qr-code" />);

    await screen.findByTestId('qr-code-image');

    // Default colors clear the threshold.
    expect(
      (screen.getByTestId('qr-code-contrast-status') as HTMLElement).textContent
    ).toContain('clears the WCAG-AA');

    const dark = screen.getByTestId('qr-code-color-dark') as HTMLInputElement;
    // Yellow on white is the canonical low-contrast pair.
    fireEvent.input(dark, { target: { value: '#ffff00' } });

    await waitFor(() => {
      expect(
        (screen.getByTestId('qr-code-contrast-status') as HTMLElement).textContent
      ).toContain('below the 4.5:1');
    });
  });

  it('resets the colors and disables the high-contrast preset on reset (implementation note)', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="qr-code" />);

    await screen.findByTestId('qr-code-image');

    const dark = screen.getByTestId('qr-code-color-dark') as HTMLInputElement;
    fireEvent.input(dark, { target: { value: '#1a73e8' } });
    await user.click(screen.getByTestId('qr-code-high-contrast'));

    await user.click(screen.getByTestId('qr-code-color-reset'));

    expect(
      (screen.getByTestId('qr-code-high-contrast') as HTMLInputElement).checked
    ).toBe(false);
    expect(
      (screen.getByTestId('qr-code-color-dark-readout') as HTMLElement).textContent
    ).toBe('#000000');
  });

  // ------------------------------------------------- implementation note: SVG download

  it('exposes a Download as SVG anchor with a base64 SVG data URL (implementation note)', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="qr-code" />);

    const anchor = (await screen.findByTestId('qr-code-download-svg')) as HTMLAnchorElement;
    expect(anchor.getAttribute('href')?.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(anchor.getAttribute('download')).toBe('qr-code.svg');
  });

  // -------------------------------------- implementation note: utilityOutputStore wiring

  it('registers the active PNG data URL with utilityOutputStore in generate mode (implementation note)', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="qr-code" />);

    await screen.findByTestId('qr-code-image');

    await waitFor(() => {
      const provider = useUtilityOutputStore.getState().provider;
      expect(provider).toBeTruthy();
      expect(provider?.()).toMatch(/^data:image\/png;base64,/);
    });
  });

  it('switches the registered output to the decoded text in decode mode (implementation note)', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="qr-code" />);

    await screen.findByTestId('qr-code-image');
    await user.selectOptions(screen.getByTestId('qr-code-mode'), 'decode');

    const fileInput = screen.getByTestId('qr-code-decode-input') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], 'qr.png', { type: 'image/png' });
    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(screen.getByTestId('qr-code-decoded-payload')).toBeTruthy();
    });
    await waitFor(() => {
      const provider = useUtilityOutputStore.getState().provider;
      expect(provider?.()).toBe('https://decoded.example/lingua');
    });
  });
});

afterEach(() => {
  // Clear the utility-output store so the next test starts clean.
  useUtilityOutputStore.getState().clearProvider();
});
