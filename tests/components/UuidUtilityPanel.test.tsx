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

describe('UuidUtilityPanel', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('switching the identifier type immediately regenerates the batch', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="uuid" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const firstBatch = screen
      .getAllByTestId('uuid-generated-value')
      .map((el) => el.textContent ?? '');
    expect(firstBatch).toHaveLength(3);
    firstBatch.forEach((value) =>
      expect(value).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      )
    );

    await user.selectOptions(screen.getByTestId('uuid-version-select'), 'v7');

    const v7Batch = screen
      .getAllByTestId('uuid-generated-value')
      .map((el) => el.textContent ?? '');
    v7Batch.forEach((value) =>
      expect(value).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      )
    );

    await user.selectOptions(screen.getByTestId('uuid-version-select'), 'ulid');
    const ulidBatch = screen
      .getAllByTestId('uuid-generated-value')
      .map((el) => el.textContent ?? '');
    ulidBatch.forEach((value) => expect(value).toHaveLength(26));
  });

  it('decodes a pasted UUID v7 and surfaces its embedded timestamp', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="uuid" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    // Generate a v7 so we have a real one to paste.
    await user.selectOptions(screen.getByTestId('uuid-version-select'), 'v7');
    const generated =
      screen.getAllByTestId('uuid-generated-value')[0]?.textContent ?? '';
    expect(generated).toMatch(/-7[0-9a-f]{3}-/);

    await user.type(screen.getByTestId('uuid-decoder-input'), generated);

    const result = await screen.findByTestId('uuid-decoder-result');
    expect(result.textContent ?? '').toMatch(/UUID v7/);
    expect(result.textContent ?? '').toMatch(/Embedded timestamp/);
  });

  it('shows the unrecognized hint for a random string', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="uuid" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await user.type(screen.getByTestId('uuid-decoder-input'), 'totally bogus');
    expect(
      screen.getByText('That value is not a recognized UUID or ULID.')
    ).toBeTruthy();
  });

  it('shows the idle copy when the decoder field is empty', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="uuid" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
    expect(screen.getByText('Paste an identifier to decode it.')).toBeTruthy();
  });

  it('renders Spanish copy when the locale switches', async () => {
    await i18next.changeLanguage('es');
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="uuid" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
    expect(
      screen.getByRole('heading', { level: 3, name: /Decodificar identificador/i })
    ).toBeTruthy();
  });
});
