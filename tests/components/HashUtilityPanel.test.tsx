/**
 * RL-071 — HashUtilityPanel tests. Helper coverage lives in
 * tests/utils/developerUtilities.test.ts; this suite focuses on wiring:
 * mode + source + algorithm toggles, conditional fields, HMAC key
 * requirement, MD5/SHA-384/SHA-512 digests rendering through the panel,
 * error banners, ES locale.
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

describe('HashUtilityPanel', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('defaults to Plain mode, Text source, SHA-256 and renders the seeded digest', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="hash" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    expect((screen.getByTestId('hash-mode') as HTMLSelectElement).value).toBe('plain');
    expect((screen.getByTestId('hash-source') as HTMLSelectElement).value).toBe('text');
    expect((screen.getByTestId('hash-algorithm') as HTMLSelectElement).value).toBe('SHA-256');

    await waitFor(() => {
      const output = screen.getByTestId('hash-output') as HTMLTextAreaElement;
      // SHA-256 of "Lingua".
      expect(output.value).toBe(
        '0fcc9b7d744c5feeeaad15919402773216cba26b703a5ad3e0724c2ab2d315ee',
      );
    });
  });

  it('switching the algorithm to SHA-384 re-renders the digest with 96 hex chars', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="hash" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await user.selectOptions(screen.getByTestId('hash-algorithm'), 'SHA-384');

    await waitFor(() => {
      const output = screen.getByTestId('hash-output') as HTMLTextAreaElement;
      expect(output.value).toHaveLength(96);
    });
  });

  it('switching the algorithm to MD5 produces the known 32-char hex digest', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="hash" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const input = screen.getByTestId('hash-input-text') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'abc' } });
    await user.selectOptions(screen.getByTestId('hash-algorithm'), 'MD5');

    await waitFor(() => {
      const output = screen.getByTestId('hash-output') as HTMLTextAreaElement;
      expect(output.value).toBe('900150983cd24fb0d6963f7d28e17f72');
    });
  });

  it('HMAC mode hides MD5 from the algorithm list and shows the key field', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="hash" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await user.selectOptions(screen.getByTestId('hash-mode'), 'hmac');

    const algoSelect = screen.getByTestId('hash-algorithm') as HTMLSelectElement;
    const labels = Array.from(algoSelect.options).map((option) => option.value);
    expect(labels).not.toContain('MD5');
    expect(labels).toEqual(['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']);

    expect(screen.getByTestId('hash-hmac-key')).toBeTruthy();
  });

  it('HMAC mode with an empty key surfaces the emptyKey error', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="hash" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await user.selectOptions(screen.getByTestId('hash-mode'), 'hmac');

    await waitFor(() => {
      expect(screen.getByText(/HMAC mode requires a non-empty key/)).toBeTruthy();
    });
    expect(screen.queryByTestId('hash-output')).toBeNull();
  });

  it('HMAC-SHA-256 with the pinned key produces the RFC-style vector', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="hash" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const input = screen.getByTestId('hash-input-text') as HTMLTextAreaElement;
    fireEvent.change(input, {
      target: { value: 'The quick brown fox jumps over the lazy dog' },
    });
    await user.selectOptions(screen.getByTestId('hash-mode'), 'hmac');
    const keyInput = screen.getByTestId('hash-hmac-key') as HTMLInputElement;
    fireEvent.change(keyInput, { target: { value: 'key' } });

    await waitFor(() => {
      const output = screen.getByTestId('hash-output') as HTMLTextAreaElement;
      expect(output.value).toBe(
        'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
      );
    });
  });

  it('switching the input source to File reveals the drop zone and hides the text area', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="hash" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await user.selectOptions(screen.getByTestId('hash-source'), 'file');

    expect(screen.getByTestId('hash-dropzone')).toBeTruthy();
    expect(screen.getByTestId('hash-file-input')).toBeTruthy();
    expect(screen.queryByTestId('hash-input-text')).toBeNull();
    // No file chosen yet -> empty-input hint.
    await waitFor(() => {
      expect(
        screen.getByText(/Enter input above or drop a file to compute a hash/),
      ).toBeTruthy();
    });
  });

  it('clearing the text input shows the empty-state hint', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="hash" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const input = screen.getByTestId('hash-input-text') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '' } });

    await waitFor(() => {
      expect(
        screen.getByText(/Enter input above or drop a file to compute a hash/),
      ).toBeTruthy();
    });
    expect(screen.queryByTestId('hash-output')).toBeNull();
  });

  it('renders raw platform error details under the translated hash error', async () => {
    const digestSpy = vi
      .spyOn(crypto.subtle, 'digest')
      .mockRejectedValueOnce(new Error('SubtleCrypto unavailable'));

    try {
      render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="hash" />);
      await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

      await waitFor(() => {
        expect(screen.getByTestId('hash-error').textContent).toContain(
          'Hash computation failed.'
        );
      });
      expect(screen.getByTestId('hash-error-detail').textContent).toContain(
        'SubtleCrypto unavailable'
      );
    } finally {
      digestSpy.mockRestore();
    }
  });

  it('localizes the panel to Spanish when the locale switches', async () => {
    await i18next.changeLanguage('es');
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="hash" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const modeSelect = screen.getByTestId('hash-mode') as HTMLSelectElement;
    const modeLabels = Array.from(modeSelect.options).map((option) => option.textContent);
    expect(modeLabels).toContain('Plano');
    expect(modeLabels).toContain('HMAC');

    const sourceSelect = screen.getByTestId('hash-source') as HTMLSelectElement;
    const sourceLabels = Array.from(sourceSelect.options).map(
      (option) => option.textContent,
    );
    expect(sourceLabels).toContain('Texto');
    expect(sourceLabels).toContain('Archivo');
  });
});
