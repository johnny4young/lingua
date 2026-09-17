/**
 * `DeveloperUtilitiesModal` renders each utility panel through `React.lazy`.
 * A lazy component renders synchronously only after its first load resolves,
 * and that first load is slow under coverage instrumentation on a busy
 * runner. Without a warm-up, the first test in a file pays for it inside a
 * short `waitFor`, and later tests that query a panel right after rendering
 * only pass because an earlier test already resolved it.
 *
 * Call `warmUpUtilityPanels` from a file-level `beforeAll` with every utility
 * the file opens, so each test finds its panel on its own.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import { expect } from 'vitest';
import { DeveloperUtilitiesModal } from '../../src/renderer/components/DeveloperUtilities/DeveloperUtilitiesModal';
import type { DeveloperUtilityId } from '../../src/renderer/data/developerUtilities';
import { initI18n } from '../../src/renderer/i18n';

/** Generous: the slow first import is exactly what this waits out. */
export const UTILITY_PANEL_WARM_UP_TIMEOUT_MS = 60_000;

export async function warmUpUtilityPanels(ids: readonly DeveloperUtilityId[]): Promise<void> {
  initI18n('en');
  for (const id of ids) {
    const { unmount } = render(<DeveloperUtilitiesModal onClose={() => {}} initialUtilityId={id} />);
    // The panel's cache slot exists at once; it holds the Suspense fallback
    // until the lazy panel resolves, then the panel itself.
    await waitFor(
      () => {
        const slot = screen.getByTestId(`utility-panel-cache-${id}`);
        expect(within(slot).queryByTestId('utility-panel-loading')).toBeNull();
        expect(slot.childElementCount).toBeGreaterThan(0);
      },
      { timeout: 10_000 }
    );
    unmount();
  }
}
