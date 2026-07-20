/**
 * internal — JwtUtilityPanel tests. The helper round-trips are covered in
 * tests/utils/jwt.test.ts, so this suite focuses on wiring: mode
 * toggle swaps the rendered form, the Verify pass/fail indicators
 * appear with the right testids, Sign produces a copyable token, and
 * Spanish copy resolves.
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

function toBase64Url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

describe('JwtUtilityPanel', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('renders the Decode form by default and preserves the existing decode output', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="jwt" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    // Mode selector lands on `decode`.
    const modeSelect = screen.getByTestId('jwt-mode') as HTMLSelectElement;
    expect(modeSelect.value).toBe('decode');

    // Seed token parses — header copy button proves the tree rendered.
    expect(screen.getByTestId('jwt-decode-token')).toBeTruthy();
    expect(screen.getByTestId('jwt-header-copy')).toBeTruthy();
    expect(screen.getByTestId('jwt-header-output').tagName).toBe('PRE');
    expect(screen.getByTestId('jwt-payload-output').tagName).toBe('PRE');
  });

  it('colors JWT segments and highlights timestamp claims with local and UTC hover metadata', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="jwt" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const token = [
      toBase64Url({ alg: 'HS256', typ: 'JWT' }),
      toBase64Url({ sub: 'lingua', iat: 1783624472, exp: 1783624472 }),
      'signature',
    ].join('.');
    fireEvent.change(screen.getByTestId('jwt-decode-token'), {
      target: { value: token },
    });

    // The COLORED characters live in the token input's own overlay —
    // exactly the textarea's value, segment-colored, with no duplicated
    // preview block anywhere.
    expect(screen.queryByTestId('jwt-preview')).toBeNull();
    expect(screen.getByTestId('jwt-decode-token-overlay').textContent).toBe(token);
    expect(screen.getByTestId('jwt-token-header').textContent).toBe(token.split('.')[0]);
    expect(screen.getByTestId('jwt-token-payload').textContent).toBe(token.split('.')[1]);
    expect(screen.getByTestId('jwt-token-signature').textContent).toBe('signature');
    expect(screen.getByTestId('jwt-signature-status').textContent).toContain('Not verified');
    const timestampValues = screen.getAllByTestId('json-timestamp-value');
    expect(timestampValues.map(node => node.textContent)).toEqual(['1783624472', '1783624472']);
    expect(new Set(timestampValues.map(node => node.getAttribute('aria-describedby'))).size).toBe(
      2
    );
    expect(screen.getAllByText('Local time')).toHaveLength(2);
    expect(screen.getAllByText('UTC')).toHaveLength(2);
  });

  it('swaps to the Sign form when the user picks Sign mode', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="jwt" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await user.selectOptions(screen.getByTestId('jwt-mode'), 'sign');

    expect(screen.getByTestId('jwt-sign-header')).toBeTruthy();
    expect(screen.getByTestId('jwt-sign-payload')).toBeTruthy();
    expect(screen.getByTestId('jwt-sign-key')).toBeTruthy();
    expect(screen.getByTestId('jwt-sign-algorithm')).toBeTruthy();
    expect(screen.getByTestId('jwt-sign-run')).toBeTruthy();
    expect(screen.queryByTestId('jwt-decode-token')).toBeNull();
  });

  it('round-trips Sign → Verify with HS256 and shows the PASS indicator', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="jwt" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    // Sign a token first.
    await user.selectOptions(screen.getByTestId('jwt-mode'), 'sign');
    const signKey = screen.getByTestId('jwt-sign-key') as HTMLTextAreaElement;
    await user.type(signKey, 'this-secret-is-exactly-32-bytes!');
    await user.click(screen.getByTestId('jwt-sign-run'));

    const resultField = (await screen.findByTestId('jwt-sign-result')) as HTMLTextAreaElement;
    const token = resultField.value;
    expect(token.split('.')).toHaveLength(3);

    // Switch to verify, paste the same token + key.
    await user.selectOptions(screen.getByTestId('jwt-mode'), 'verify');
    const verifyTokenField = screen.getByTestId('jwt-verify-token') as HTMLTextAreaElement;
    // Replace the seeded token with the one we just signed.
    await user.clear(verifyTokenField);
    await user.type(verifyTokenField, token);
    const verifyKey = screen.getByTestId('jwt-verify-key') as HTMLTextAreaElement;
    await user.type(verifyKey, 'this-secret-is-exactly-32-bytes!');
    await user.click(screen.getByTestId('jwt-verify-run'));

    await waitFor(() => {
      expect(screen.getByTestId('jwt-verify-result-pass')).toBeTruthy();
    });
    expect(screen.getByTestId('jwt-signature-status').textContent).toContain('Signature verified');

    await user.type(verifyTokenField, 'x');
    await waitFor(() => {
      expect(screen.queryByTestId('jwt-verify-result-pass')).toBeNull();
    });
    expect(screen.getByTestId('jwt-signature-status').textContent).toContain('Not verified');
  });

  it('shows the FAIL indicator when the Verify key does not match', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="jwt" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    // Seeded token uses "signature" as its third segment — not a real
    // signature. So any real key will fail verification with HS256.
    await user.selectOptions(screen.getByTestId('jwt-mode'), 'verify');
    const verifyKey = screen.getByTestId('jwt-verify-key') as HTMLTextAreaElement;
    await user.type(verifyKey, 'any-key-that-is-long-enough-32bytes!');
    await user.click(screen.getByTestId('jwt-verify-run'));

    await waitFor(() => {
      expect(screen.getByTestId('jwt-verify-result-fail')).toBeTruthy();
    });
    expect(screen.queryByTestId('jwt-verify-result-pass')).toBeNull();
  });

  it('flags invalid JSON in the Sign header with the discriminated error', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="jwt" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await user.selectOptions(screen.getByTestId('jwt-mode'), 'sign');

    const headerField = screen.getByTestId('jwt-sign-header') as HTMLTextAreaElement;
    await user.clear(headerField);
    await user.type(headerField, 'not json');

    const keyField = screen.getByTestId('jwt-sign-key') as HTMLTextAreaElement;
    await user.type(keyField, 'this-secret-is-exactly-32-bytes!');
    await user.click(screen.getByTestId('jwt-sign-run'));

    await waitFor(() => {
      expect(screen.getByTestId('jwt-sign-result-error')).toBeTruthy();
    });
    expect(screen.queryByTestId('jwt-sign-result')).toBeNull();
  });

  it('localizes the mode selector options to Spanish', async () => {
    await i18next.changeLanguage('es');
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="jwt" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const modeSelect = screen.getByTestId('jwt-mode') as HTMLSelectElement;
    const labels = Array.from(modeSelect.options).map(opt => opt.textContent);
    expect(labels).toContain('Decodificar');
    expect(labels).toContain('Verificar');
    expect(labels).toContain('Firmar');
  });

  it('exposes the full HS / RS / ES / PS algorithm set in both Verify and Sign selects', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="jwt" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const expected = [
      'HS256',
      'HS384',
      'HS512',
      'RS256',
      'RS384',
      'RS512',
      'ES256',
      'ES384',
      'ES512',
      'PS256',
      'PS384',
      'PS512',
    ];

    await user.selectOptions(screen.getByTestId('jwt-mode'), 'verify');
    const verifyOptions = Array.from(
      (screen.getByTestId('jwt-verify-algorithm') as HTMLSelectElement).options
    ).map(opt => opt.value);
    expect(verifyOptions).toEqual(expected);

    await user.selectOptions(screen.getByTestId('jwt-mode'), 'sign');
    const signOptions = Array.from(
      (screen.getByTestId('jwt-sign-algorithm') as HTMLSelectElement).options
    ).map(opt => opt.value);
    expect(signOptions).toEqual(expected);
  });
});
