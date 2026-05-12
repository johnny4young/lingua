/**
 * RL-026 Slice 4 — `GoLanguageIntelligenceRow` mount conditions.
 *
 * Mirrors the rust counterpart. The row mounts only when the gopls
 * status is `'unavailable'` or `'degraded'`; happy / unknown paths
 * keep Settings quiet (the toast covers happy-path readiness).
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initI18n } from '@/i18n';
import { GoLanguageIntelligenceRow } from '@/components/Settings/GoLanguageIntelligenceRow';
import { useGoLanguageStore } from '@/stores/goLanguageStore';

describe('GoLanguageIntelligenceRow', () => {
  beforeEach(async () => {
    useGoLanguageStore.getState().reset();
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when the status is unknown', () => {
    useGoLanguageStore.getState().setStatus({ kind: 'unknown' });
    const { container } = render(<GoLanguageIntelligenceRow />);
    expect(container.textContent).toBe('');
  });

  it('renders nothing when gopls is available (toast covers this case)', () => {
    useGoLanguageStore
      .getState()
      .setStatus({ kind: 'available', version: 'golang.org/x/tools/gopls v0.16.2' });
    const { container } = render(<GoLanguageIntelligenceRow />);
    expect(container.textContent).toBe('');
  });

  it('surfaces the install hint with the go install command when missing', () => {
    useGoLanguageStore
      .getState()
      .setStatus({ kind: 'unavailable', reason: 'missing' });
    render(<GoLanguageIntelligenceRow />);
    expect(
      screen.getByText(
        /gopls is not on PATH\. Install with: go install golang\.org\/x\/tools\/gopls@latest/
      )
    ).toBeTruthy();
  });

  it('surfaces the desktop-only copy on the web build', () => {
    useGoLanguageStore
      .getState()
      .setStatus({ kind: 'unavailable', reason: 'web-build' });
    render(<GoLanguageIntelligenceRow />);
    expect(screen.getByText(/desktop only/i)).toBeTruthy();
    expect(screen.getByText(/local subprocess/i)).toBeTruthy();
  });

  it('renders the restart button when degraded and calls the IPC on click', async () => {
    const restart = vi.fn().mockResolvedValue({ kind: 'starting' });
    (window as unknown as { lingua: { lsp: { go: { restart: () => Promise<unknown> } } } }).lingua = {
      lsp: { go: { restart } },
    } as never;

    useGoLanguageStore
      .getState()
      .setStatus({ kind: 'degraded', detail: 'code=137 signal=null' });

    render(<GoLanguageIntelligenceRow />);
    const button = screen.getByTestId('settings-go-lsp-restart');
    await userEvent.click(button);
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('renders Spanish copy in neutral LatAm tuteo when locale is es', async () => {
    await i18next.changeLanguage('es');
    useGoLanguageStore
      .getState()
      .setStatus({ kind: 'unavailable', reason: 'missing' });

    render(<GoLanguageIntelligenceRow />);
    expect(
      screen.getByText(/Instálalo con: go install golang\.org\/x\/tools\/gopls@latest/)
    ).toBeTruthy();
    // Voseo would be `Instalalo` — make sure tuteo wins.
    expect(screen.queryByText(/Instalalo con/)).toBeNull();
  });

  it('renders the Spanish restart button with tuteo (Reinicia)', async () => {
    (window as unknown as { lingua: unknown }).lingua = {
      lsp: { go: { restart: vi.fn().mockResolvedValue({ kind: 'starting' }) } },
    } as never;
    await i18next.changeLanguage('es');
    useGoLanguageStore.getState().setStatus({ kind: 'degraded' });

    render(<GoLanguageIntelligenceRow />);
    const button = screen.getByTestId('settings-go-lsp-restart');
    expect(button.textContent).toBe('Reinicia gopls');
    expect(button.textContent).not.toMatch(/Reiniciá/);
  });
});
