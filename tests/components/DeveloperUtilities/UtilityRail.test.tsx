import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UtilityRail } from '../../../src/renderer/components/DeveloperUtilities/UtilityRail';
import type { UtilityCategory } from '../../../src/renderer/data/utilityCategories';
import '../../../src/renderer/i18n/clipboardChainsCatalog';

const rail = (suggested: UtilityCategory[]) => (
  <UtilityRail
    activeCategory="data"
    pipelinesActive={false}
    suggestedCategories={new Set(suggested)}
    onSearch={vi.fn()}
    onFavorites={vi.fn()}
    onCategory={vi.fn()}
    onPipelines={vi.fn()}
    onExpand={vi.fn()}
  />
);

describe('UtilityRail clipboard marks', () => {
  it('marks a suggested category, and says so to a screen reader', () => {
    render(rail(['crypto']));
    expect(screen.getByTestId('utility-rail-crypto-suggested')).toBeTruthy();
    expect(screen.getByTestId('utility-rail-crypto').getAttribute('aria-label')).toMatch(/suggested for your clipboard/);
    expect(screen.queryByTestId('utility-rail-time-suggested')).toBeNull();
    expect(screen.getByTestId('utility-rail-time').getAttribute('aria-label')).not.toMatch(/clipboard/);
  });

  it('marks nothing with no suggestion', () => {
    render(rail([]));
    expect(screen.queryByTestId('utility-rail-crypto-suggested')).toBeNull();
  });
});
