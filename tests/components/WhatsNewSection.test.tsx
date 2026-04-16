import { render, screen } from '@testing-library/react';
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

  it('highlights the current version and keeps older entries collapsible', async () => {
    render(<WhatsNewSection entries={entries} onClose={() => {}} />);

    expect(await screen.findByText('Current version highlights')).toBeTruthy();
    expect(screen.getByText('0.1.0')).toBeTruthy();
    expect(screen.getByText('stable', { selector: 'strong' })).toBeTruthy();
    expect(screen.getByText('feature', { selector: 'code' })).toBeTruthy();
    expect(screen.getByText('Older release notes')).toBeTruthy();
  });
});
