import { render, screen } from '@testing-library/react';
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

describe('NumberBaseUtilityPanel', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('renders with the initial demo value propagated across every base', () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="number-base" />);

    expect((screen.getByTestId('number-base-input-decimal') as HTMLInputElement).value).toBe('255');
    expect((screen.getByTestId('number-base-input-hex') as HTMLInputElement).value).toBe('FF');
    expect((screen.getByTestId('number-base-input-binary') as HTMLInputElement).value).toBe(
      '11111111'
    );
    expect((screen.getByTestId('number-base-input-octal') as HTMLInputElement).value).toBe('377');
  });

  it('propagates typing in the hex field to every other base', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="number-base" />);

    const hex = screen.getByTestId('number-base-input-hex') as HTMLInputElement;
    await user.clear(hex);
    await user.type(hex, 'ABCD');

    expect((screen.getByTestId('number-base-input-decimal') as HTMLInputElement).value).toBe(
      '43981'
    );
    expect((screen.getByTestId('number-base-input-binary') as HTMLInputElement).value).toBe(
      '1010101111001101'
    );
  });

  it('flags an invalid binary entry without clobbering the other views', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="number-base" />);

    const binary = screen.getByTestId('number-base-input-binary') as HTMLInputElement;
    await user.clear(binary);
    // Start with an invalid character so there's never an intermediate valid
    // parse that would stomp the shared value — this is the real "user
    // pasted garbage" case the error state exists to protect.
    await user.type(binary, 'zzz');

    expect(screen.getByText('That value does not parse in the selected base.')).toBeTruthy();
    // Hex view should retain its prior good value (255 → FF).
    expect((screen.getByTestId('number-base-input-hex') as HTMLInputElement).value).toBe('FF');
  });

  it('clears the invalid banner on blur once the field snaps back to the last good value', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="number-base" />);

    const binary = screen.getByTestId('number-base-input-binary') as HTMLInputElement;
    await user.clear(binary);
    await user.type(binary, 'zzz');
    expect(screen.getByText('That value does not parse in the selected base.')).toBeTruthy();

    await user.tab();

    expect(screen.queryByText('That value does not parse in the selected base.')).toBeNull();
    expect((screen.getByTestId('number-base-input-binary') as HTMLInputElement).value).toBe(
      '11111111'
    );
  });

  it('honors the 0x prefix in the decimal field', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="number-base" />);

    const decimal = screen.getByTestId('number-base-input-decimal') as HTMLInputElement;
    await user.clear(decimal);
    await user.type(decimal, '0xff');

    expect((screen.getByTestId('number-base-input-hex') as HTMLInputElement).value).toBe('FF');
    expect((screen.getByTestId('number-base-input-binary') as HTMLInputElement).value).toBe(
      '11111111'
    );
  });

  it('surfaces localized Spanish copy when the locale switches', async () => {
    await i18next.changeLanguage('es');
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="number-base" />);

    // The panel heading specifically (not the nav/action label) uses the
    // `utilities.tool.numberBase.title` key, which renders as "Bases
    // numéricas" in ES. Matching against level 3 (<h3>) pins the assertion
    // to the inner panel header and not the dialog-level <h2>.
    expect(
      screen.getByRole('heading', { level: 3, name: /Bases num[eé]ricas/i })
    ).toBeTruthy();
  });
});
