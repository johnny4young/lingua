/**
 * RL-068 — HTML Entity Encode/Decode panel tests. The pure helper is
 * covered in tests/utils/htmlEntity.test.ts, so this suite only verifies
 * wiring: mode changes, live output updates, the unresolved-count hint,
 * and Spanish locale parity.
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

describe('HtmlEntityPanel', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('defaults to named encoding and produces escaped output for the seeded input', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="html-entity" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const output = screen.getByTestId('html-entity-output') as HTMLTextAreaElement;
    expect(output.value).toContain('&lt;p class=&quot;lead&quot;&gt;');
    expect(output.value).toContain('&copy;');
    expect(output.value).toContain('&ntilde;');
  });

  it('switches to minimal encoding and drops named entities for non-structural chars', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="html-entity" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await user.selectOptions(screen.getByTestId('html-entity-mode'), 'encode-minimal');

    const output = screen.getByTestId('html-entity-output') as HTMLTextAreaElement;
    // Minimal only escapes <, >, &, ", ' — `©` and `ñ` pass through untouched.
    expect(output.value).toContain('©');
    expect(output.value).toContain('ñ');
    expect(output.value).not.toContain('&copy;');
    expect(output.value).not.toContain('&ntilde;');
  });

  it('switches to numeric encoding and emits decimal references for non-ASCII chars', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="html-entity" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await user.selectOptions(screen.getByTestId('html-entity-mode'), 'encode-numeric');

    const output = screen.getByTestId('html-entity-output') as HTMLTextAreaElement;
    expect(output.value).toContain('&#169;'); // ©
    expect(output.value).toContain('&#241;'); // ñ
  });

  it('decodes in decode mode and surfaces the unresolved counter for unknown references', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="html-entity" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await user.selectOptions(screen.getByTestId('html-entity-mode'), 'decode');
    const input = screen.getByTestId('html-entity-input') as HTMLTextAreaElement;
    await user.clear(input);
    await user.type(input, '&lt;p&gt;&copy; &unknownEntity; &#241;</p>');

    const output = screen.getByTestId('html-entity-output') as HTMLTextAreaElement;
    expect(output.value).toBe('<p>© &unknownEntity; ñ</p>');
    expect(
      screen.getByText(/entity could not be resolved|entities could not be resolved/i),
    ).toBeTruthy();
  });

  it('hides the unresolved counter when every reference decodes cleanly', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="html-entity" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await user.selectOptions(screen.getByTestId('html-entity-mode'), 'decode');
    const input = screen.getByTestId('html-entity-input') as HTMLTextAreaElement;
    await user.clear(input);
    await user.type(input, '&lt;p&gt;&copy;</p>');

    expect(
      screen.queryByText(/entity could not be resolved|entities could not be resolved/i),
    ).toBeNull();
  });

  it('localizes the mode selector options to Spanish', async () => {
    await i18next.changeLanguage('es');
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="html-entity" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const select = screen.getByTestId('html-entity-mode') as HTMLSelectElement;
    const labels = Array.from(select.options).map((opt) => opt.textContent);
    expect(labels).toContain('Codificar (mínimo)');
    expect(labels).toContain('Codificar (con nombres)');
    expect(labels).toContain('Codificar (numérico)');
    expect(labels).toContain('Decodificar');
  });
});
