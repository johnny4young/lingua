import { cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import { AutoLogStatusPill } from '@/components/Editor/AutoLogStatusPill';

const { activeTabMock } = vi.hoisted(() => ({ activeTabMock: vi.fn() }));
vi.mock('@/hooks/useActiveTab', () => ({ useActiveTab: () => activeTabMock() }));

describe('AutoLogStatusPill', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });
  afterEach(() => cleanup());

  it('names the language in its tooltip, not a raw key', () => {
    activeTabMock.mockReturnValue({
      language: 'python',
      workflowMode: 'scratchpad',
      autoLogEnabled: true,
    });
    render(<AutoLogStatusPill />);
    const pill = document.querySelector('[data-result-kind="autoLog-pill"]');
    expect(pill?.getAttribute('aria-label')).toContain('Python');
    expect(pill?.getAttribute('aria-label')).not.toMatch(/autoLog\.|workflowMode\./);
    expect(screen.getByText(i18next.t('autoLog.statusPill.shortLabel'))).toBeTruthy();
  });
});
