/**
 * JwtUtilityPanel tests. The helper round-trips are covered in
 * tests/utils/jwt.test.ts, so this suite focuses on wiring: mode
 * toggle swaps the rendered form, the Verify pass/fail indicators
 * appear with the right testids, Sign produces a copyable token, and
 * Spanish copy resolves.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';
import { DeveloperUtilitiesModal } from '../../src/renderer/components/DeveloperUtilities/DeveloperUtilitiesModal';
import {
  UTILITY_PANEL_WARM_UP_TIMEOUT_MS,
  warmUpUtilityPanels,
} from '../__fixtures__/utilityPanels';

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

// Resolve every lazy panel this file opens before any test runs
// (tests/__fixtures__/utilityPanels.tsx).
beforeAll(() => warmUpUtilityPanels(['jwt']), UTILITY_PANEL_WARM_UP_TIMEOUT_MS);

describe('JwtUtilityPanel', () => {
  const originalCss = globalThis.CSS;

  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
    // JsonSyntaxOutput picks its rendering path by probing CSS.escape: absent,
    // it decorates timestamps synchronously on plain text; present, it waits
    // for Monaco to colorize first. jsdom 30 ships CSS.escape, so pin the
    // plain-text path this suite was written against. The Monaco path has its
    // own coverage in JsonSyntaxOutput.test.tsx, which pins the opposite way.
    Object.defineProperty(globalThis, 'CSS', { configurable: true, value: undefined });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'CSS', { configurable: true, value: originalCss });
  });

  it('renders the Decode form by default with one answer in the header', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="jwt" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    expect(screen.getByTestId('jwt-mode-decode').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('jwt-mode-verify').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('jwt-decode-token')).toBeTruthy();
    expect(screen.getByTestId('jwt-header-copy')).toBeTruthy();
    expect(screen.getByTestId('jwt-payload-copy')).toBeTruthy();

    // The seed token never expires, so the numeral counts its claims and the meta names the algorithm only.
    const header = within(screen.getByTestId('jwt-result-header'));
    expect(header.getByTestId('result-header-tag').textContent).toBe('JWT');
    expect(header.getByTestId('result-header-numeral').textContent).toBe('2claims');
    expect(header.getByTestId('result-header-meta').textContent).toBe('HS256');

    // Typed leader rows: key, then the JSON type and the value.
    expect(screen.getByTestId('jwt-claim-alg').textContent).toBe('algstring"HS256"');
    expect(screen.getByTestId('jwt-claim-sub').textContent).toBe('substring"lingua"');
    expect(within(screen.getByTestId('jwt-header-output')).getByText(/Header · 27 bytes/u)).toBeTruthy();
    expect(within(screen.getByTestId('jwt-payload-output')).getByText(/Payload · 29 bytes/u)).toBeTruthy();
  });

  it('dates each time claim with a pill, how far it is from now, and the lifetime of exp', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 17, 1, 0, 0));
    try {
      render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="jwt" />);
      await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
      const payload = { sub: 'lingua', iat: 1792195200, exp: 1792281600, nbf: 1792368000 };
      const encode = (value: object) =>
        btoa(JSON.stringify(value)).replace(/=+$/u, '').replace(/\+/gu, '-').replace(/\//gu, '_');
      fireEvent.change(screen.getByTestId('jwt-decode-token'), {
        target: { value: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.sig` },
      });

      const header = within(screen.getByTestId('jwt-result-header'));
      expect(header.getByTestId('result-header-numeral').textContent).toBe('23h left');
      expect(header.getByTestId('result-header-meta').textContent).toBe('HS256 · 4 claims');
      expect(screen.getByTestId('jwt-time-claim-exp').dataset.state).toBe('ok');
      expect(screen.getByTestId('jwt-lifetime').getAttribute('aria-label')).toBe('4% of its lifetime used');
      expect(screen.getByTestId('jwt-time-claim-iat-relative').textContent).toBe('1 hr. ago');
      expect(screen.getByTestId('jwt-time-claim-nbf').dataset.state).toBe('pending');
      expect(screen.getByTestId('jwt-time-claim-nbf-relative').textContent).toBe('Not valid yet · in 47 hr.');

      // A token decoded later is judged against the clock at that moment.
      vi.setSystemTime(Date.UTC(2026, 9, 18, 2, 0, 0));
      fireEvent.change(screen.getByTestId('jwt-decode-token'), {
        target: {
          value: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ exp: 1792281600 })}.sig`,
        },
      });
      await waitFor(() =>
        expect(screen.getByTestId('jwt-time-claim-exp').dataset.state).toBe('expired')
      );
      expect(header.getByTestId('result-header-numeral').textContent).toBe('expired2 hr. ago');
      // Without iat there is no lifetime to draw.
      expect(screen.queryByTestId('jwt-lifetime')).toBeNull();

      // A claim past the Date range reads as a plain number instead of a crash.
      fireEvent.change(screen.getByTestId('jwt-decode-token'), {
        target: { value: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ exp: 1e308 })}.sig` },
      });
      await waitFor(() => expect(screen.queryByTestId('jwt-time-claim-exp')).toBeNull());
      expect(screen.getByTestId('jwt-claim-exp').textContent).toBe('expnumber1e+308');
      expect(header.getByTestId('result-header-numeral').textContent).toBe('1claim');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads a malformed token as invalid in the header', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="jwt" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
    fireEvent.change(screen.getByTestId('jwt-decode-token'), { target: { value: 'not-a-token' } });

    const numeral = within(screen.getByTestId('jwt-result-header')).getByTestId('result-header-numeral');
    expect(numeral.textContent).toBe('invalid');
    expect(numeral.querySelector('.result-numeral')?.getAttribute('data-tone')).toBe('error');
    expect(screen.queryByTestId('jwt-payload-output')).toBeNull();
  });

  it('colors JWT segments like the header bar and keeps the timestamp hover', async () => {
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

    // Each bar part is sized by its decoded bytes and painted like its characters.
    const parts = Array.from(screen.getByTestId('jwt-segments').querySelectorAll<HTMLElement>('[data-phase]'));
    expect(parts.map(part => [part.dataset.phase, part.style.flexGrow])).toEqual([
      ['header', '27'],
      ['payload', '50'],
      ['signature', '6'],
    ]);
    expect(parts.map(part => part.style.background)).toEqual([
      screen.getByTestId('jwt-token-header').style.color,
      screen.getByTestId('jwt-token-payload').style.color,
      screen.getByTestId('jwt-token-signature').style.color,
    ]);

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

    await user.click(screen.getByTestId('jwt-mode-sign'));

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
    await user.click(screen.getByTestId('jwt-mode-sign'));
    const signKey = screen.getByTestId('jwt-sign-key') as HTMLTextAreaElement;
    await user.type(signKey, 'this-secret-is-exactly-32-bytes!');
    await user.click(screen.getByTestId('jwt-sign-run'));

    const resultField = (await screen.findByTestId('jwt-sign-result')) as HTMLTextAreaElement;
    const token = resultField.value;
    expect(token.split('.')).toHaveLength(3);
    // In Sign mode the header reads the token just signed.
    expect(
      within(screen.getByTestId('jwt-result-header')).getByTestId('result-header-numeral').textContent
    ).toBe('2claims');

    // Switch to verify, paste the same token + key.
    await user.click(screen.getByTestId('jwt-mode-verify'));
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
    await user.click(screen.getByTestId('jwt-mode-verify'));
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

    await user.click(screen.getByTestId('jwt-mode-sign'));

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

  it('localizes the mode segment and the sections to Spanish', async () => {
    await i18next.changeLanguage('es');
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="jwt" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    expect(screen.getByTestId('jwt-mode-decode').textContent).toBe('Decodificar');
    expect(screen.getByTestId('jwt-mode-verify').textContent).toBe('Verificar');
    expect(screen.getByTestId('jwt-mode-sign').textContent).toBe('Firmar');
    const header = within(screen.getByTestId('jwt-result-header'));
    expect(header.getByTestId('result-header-numeral').textContent).toBe('2claims');
    expect(screen.getByText(/Firma · \d+ bytes/u)).toBeTruthy();
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

    await user.click(screen.getByTestId('jwt-mode-verify'));
    const verifyOptions = Array.from(
      (screen.getByTestId('jwt-verify-algorithm') as HTMLSelectElement).options
    ).map(opt => opt.value);
    expect(verifyOptions).toEqual(expected);

    await user.click(screen.getByTestId('jwt-mode-sign'));
    const signOptions = Array.from(
      (screen.getByTestId('jwt-sign-algorithm') as HTMLSelectElement).options
    ).map(opt => opt.value);
    expect(signOptions).toEqual(expected);
  });
});
