import { renderHook, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLauncherPreviews } from '../../../src/renderer/components/DeveloperUtilities/useLauncherPreviews';
import type { ClipboardPeek } from '../../../src/renderer/hooks/useClipboardSuggestion';
import { initI18n } from '../../../src/renderer/i18n';

const segment = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = (exp: number) => [segment({ alg: 'HS256' }), segment({ exp }), 'c2ln'].join('.');

describe('useLauncherPreviews', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => vi.useRealTimers());

  it('reads a JWT that arrives later against the clock of that moment', async () => {
    const { result, rerender } = renderHook(({ peek }) => useLauncherPreviews(peek), {
      initialProps: { peek: null as ClipboardPeek | null },
    });
    vi.setSystemTime(Date.now() + 60 * 60_000);
    const text = token(Math.floor(Date.now() / 1000) - 10 * 60);
    rerender({ peek: { kind: 'jwt', text, chars: text.length } });
    await waitFor(() => expect(result.current.jwt?.tone).toBe('error'));
    expect(result.current.jwt?.text).toMatch(/^expired/u);
  });
});
