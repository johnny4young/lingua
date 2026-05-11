/**
 * RL-026 Slice 3 — `RustLanguageIntelligenceRow` mount conditions.
 *
 * The row is conditional. These tests pin the matrix:
 *   - `unknown` and `available` → row absent (toast covers happy path)
 *   - `unavailable:missing` → install hint + the exact rustup command
 *   - `unavailable:web-build` → web-only copy
 *   - `degraded` → restart button wired to the IPC
 *   - Spanish locale renders tuteo (`Instálalo`, `Reinicia`, `Tócalo`)
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initI18n } from '@/i18n';
import { RustLanguageIntelligenceRow } from '@/components/Settings/RustLanguageIntelligenceRow';
import { useRustLanguageStore } from '@/stores/rustLanguageStore';

describe('RustLanguageIntelligenceRow', () => {
  beforeEach(async () => {
    useRustLanguageStore.getState().reset();
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when the status is unknown', () => {
    useRustLanguageStore.getState().setStatus({ kind: 'unknown' });
    const { container } = render(<RustLanguageIntelligenceRow />);
    expect(container.textContent).toBe('');
  });

  it('renders nothing when rust-analyzer is available (toast covers this case)', () => {
    useRustLanguageStore
      .getState()
      .setStatus({ kind: 'available', version: 'rust-analyzer 0.4.0' });
    const { container } = render(<RustLanguageIntelligenceRow />);
    expect(container.textContent).toBe('');
  });

  it('surfaces the install hint with the rustup command when missing', () => {
    useRustLanguageStore
      .getState()
      .setStatus({ kind: 'unavailable', reason: 'missing' });
    render(<RustLanguageIntelligenceRow />);
    expect(
      screen.getByText(/rust-analyzer is not on PATH\. Install with: rustup component add rust-analyzer/)
    ).toBeTruthy();
  });

  it('surfaces the desktop-only copy on the web build', () => {
    useRustLanguageStore
      .getState()
      .setStatus({ kind: 'unavailable', reason: 'web-build' });
    render(<RustLanguageIntelligenceRow />);
    expect(screen.getByText(/desktop only/i)).toBeTruthy();
    expect(screen.getByText(/local subprocess/i)).toBeTruthy();
  });

  it('renders the restart button when degraded and calls the IPC on click', async () => {
    const restart = vi.fn().mockResolvedValue({ kind: 'starting' });
    (window as unknown as { lingua: { lsp: { rust: { restart: () => Promise<unknown> } } } }).lingua = {
      lsp: { rust: { restart } },
    } as never;

    useRustLanguageStore
      .getState()
      .setStatus({ kind: 'degraded', detail: 'code=137 signal=null' });

    render(<RustLanguageIntelligenceRow />);
    const button = screen.getByTestId('settings-rust-lsp-restart');
    await userEvent.click(button);
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('renders Spanish copy in neutral LatAm tuteo when locale is es', async () => {
    await i18next.changeLanguage('es');
    useRustLanguageStore
      .getState()
      .setStatus({ kind: 'unavailable', reason: 'missing' });

    render(<RustLanguageIntelligenceRow />);
    expect(screen.getByText(/Instálalo con: rustup component add rust-analyzer/)).toBeTruthy();
    // Voseo would be `Instalalo` — make sure tuteo wins.
    expect(screen.queryByText(/Instalalo con/)).toBeNull();
  });

  it('renders the Spanish restart button with tuteo (Reinicia)', async () => {
    (window as unknown as { lingua: unknown }).lingua = {
      lsp: { rust: { restart: vi.fn().mockResolvedValue({ kind: 'starting' }) } },
    } as never;
    await i18next.changeLanguage('es');
    useRustLanguageStore.getState().setStatus({ kind: 'degraded' });

    render(<RustLanguageIntelligenceRow />);
    const button = screen.getByTestId('settings-rust-lsp-restart');
    expect(button.textContent).toBe('Reinicia rust-analyzer');
    // Voseo would be `Reiniciá` — make sure tuteo wins.
    expect(button.textContent).not.toMatch(/Reiniciá/);
  });
});
