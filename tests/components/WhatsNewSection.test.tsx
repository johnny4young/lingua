import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { initI18n } from '../../src/renderer/i18n';
import { WhatsNewSection } from '../../src/renderer/components/Settings/WhatsNewSection';
import type { ChangelogEntry } from '../../src/shared/changelog';

vi.mock('../../src/renderer/components/ui/chrome', () => ({
  IconButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  OverlayBackdrop: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  OverlayCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const entries: ChangelogEntry[] = [
  {
    version: 'Unreleased',
    date: '2026-04-16',
    unreleased: true,
    sections: [{ title: 'Added', items: ['New `feature` in progress'] }],
  },
  {
    version: '0.2.0',
    date: '2026-04-17',
    unreleased: false,
    sections: [{ title: 'Added', items: ['Newer release'] }],
  },
  {
    version: '0.1.0',
    date: '2026-04-16',
    unreleased: false,
    sections: [{ title: 'Added', items: ['Initial **stable** release'] }],
  },
];

describe('WhatsNewSection', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
    window.lingua = {
      ...window.lingua,
      getAppInfo: vi.fn().mockResolvedValue({
        productName: 'Lingua',
        version: '0.1.0',
        buildDate: '2026-04-16T00:00:00.000Z',
        licenseType: 'MIT',
        repositoryUrl: 'https://github.com/johnny4young/lingua',
        websiteUrl: null,
        licenseUrl: 'https://github.com/johnny4young/lingua/blob/main/LICENSE',
      }),
    } as LinguaAPI;
  });

  it('lists all versions in the sidebar timeline and shows the selected version detail', async () => {
    render(<WhatsNewSection entries={entries} onClose={() => {}} />);

    // RL-070 — the changelog overlay was rebuilt as a sidebar timeline
    // + detail pane. Both versions appear in the list, the current
    // version (0.1.0) is the default selection, and rich-text
    // formatting (`<strong>`, `<code>`) keeps working.
    expect(await screen.findByTestId('changelog-entry-0.1.0')).toBeTruthy();
    expect(screen.getByTestId('changelog-entry-Unreleased')).toBeTruthy();
    expect(screen.getByTestId('changelog-entry-0.2.0')).toBeTruthy();
    // The default selection follows async appInfo once it resolves,
    // even when a newer released entry appears earlier in the list.
    await waitFor(() => {
      expect(screen.getByTestId('changelog-entry-0.1.0').getAttribute('aria-pressed')).toBe(
        'true'
      );
    });
    expect(screen.getByText('stable', { selector: 'strong' })).toBeTruthy();
  });
});
