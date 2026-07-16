import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { useState } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { _resetCrashFingerprintsForTests } from '@/utils/safeBoot';

function Boom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('intentional render-time crash');
  return <p data-testid="boom-ok">all good</p>;
}

function Toggle() {
  const [crashed, setCrashed] = useState(false);
  if (crashed) throw new Error('toggled crash');
  return (
    <button data-testid="toggle-crash" type="button" onClick={() => setCrashed(true)}>
      crash
    </button>
  );
}

describe('ErrorBoundary', () => {
  let originalConsoleError: typeof console.error;

  beforeEach(async () => {
    await i18next.changeLanguage('en');
    localStorage.clear();
    // RL-090 — recordCrash dedupes by fingerprint within a 50ms
    // window, and tests fire identical errors back-to-back.
    // Reset the dedupe map so each test sees a fresh counter.
    _resetCrashFingerprintsForTests();
    // React logs uncaught errors via console.error; suppress for cleaner output.
    originalConsoleError = console.error;
    console.error = vi.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
    localStorage.clear();
  });

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary region="editor">
        <Boom shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByTestId('boom-ok')).toBeTruthy();
  });

  it('catches a render-time throw and shows the localized fallback', () => {
    render(
      <ErrorBoundary region="editor">
        <Boom shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByTestId('error-boundary-editor')).toBeTruthy();
    expect(screen.getByTestId('error-boundary-editor-copy')).toBeTruthy();
    expect(screen.getByTestId('error-boundary-editor-reload')).toBeTruthy();
    expect(screen.getByText(/intentional render-time crash/u)).toBeTruthy();
  });

  it('marks the next boot for safe mode + records a crash on catch', () => {
    render(
      <ErrorBoundary region="editor">
        <Boom shouldThrow />
      </ErrorBoundary>
    );
    expect(localStorage.getItem('lingua-safe-mode')).toBe('1');
    const log = JSON.parse(localStorage.getItem('lingua-crash-log') ?? '[]');
    expect(log).toHaveLength(1);
  });

  it('hides the Reset to defaults button when no onReset is provided', () => {
    render(
      <ErrorBoundary region="editor">
        <Boom shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.queryByTestId('error-boundary-editor-reset')).toBeNull();
  });

  it('renders the Reset to defaults button when onReset is provided and calls it on click', () => {
    const onReset = vi.fn();
    render(
      <ErrorBoundary region="editor" onReset={onReset}>
        <Toggle />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByTestId('toggle-crash'));
    expect(screen.getByTestId('error-boundary-editor')).toBeTruthy();
    fireEvent.click(screen.getByTestId('error-boundary-editor-reset'));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('renders the compact panel recovery surface and delegates retry to its owner', () => {
    const onRetry = vi.fn();
    render(
      <ErrorBoundary region="notebook" variant="panel" onRetry={onRetry}>
        <Boom shouldThrow />
      </ErrorBoundary>
    );

    const fallback = screen.getByTestId('error-boundary-notebook');
    expect(fallback.textContent).toContain('Error · the notebook workspace');
    expect(fallback.textContent).toContain('This panel crashed while rendering');
    expect(screen.getByTestId('error-boundary-notebook-copy')).toBeTruthy();
    expect(screen.queryByTestId('error-boundary-notebook-reload')).toBeNull();
    expect(screen.queryByTestId('error-boundary-notebook-reset')).toBeNull();

    fireEvent.click(screen.getByTestId('error-boundary-notebook-retry'));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('Copy report button writes the redacted JSON to navigator.clipboard', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(
      <ErrorBoundary region="editor">
        <Boom shouldThrow />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByTestId('error-boundary-editor-copy'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledOnce();
    });
    const written = writeText.mock.calls[0][0] as string;
    expect(written).toContain('"region": "editor"');
    expect(written).toContain('"errorName": "Error"');
    expect(written).not.toMatch(/\/Users\/johnny/u);
  });

  it('renders ES copy when locale is set to Spanish', async () => {
    await i18next.changeLanguage('es');
    render(
      <ErrorBoundary region="editor">
        <Boom shouldThrow />
      </ErrorBoundary>
    );
    // The Spanish title interpolates the region label; assert the
    // localized button copies are present.
    expect(screen.getByTestId('error-boundary-editor-reload').textContent).toMatch(/modo seguro/iu);
  });

  it('renders the regional panel recovery copy in Spanish', async () => {
    await i18next.changeLanguage('es');
    render(
      <ErrorBoundary region="notebook" variant="panel" onRetry={vi.fn()}>
        <Boom shouldThrow />
      </ErrorBoundary>
    );

    const fallback = screen.getByTestId('error-boundary-notebook');
    expect(fallback.textContent).toContain('Error · el espacio de notebooks');
    expect(fallback.textContent).toContain('El resto de la app sigue funcionando');
    expect(screen.getByTestId('error-boundary-notebook-retry').textContent).toContain('Reintentar');
  });
});
