/**
 * Lazy mount point for the release-highlights overlay.
 *
 * Exists so `CHANGELOG_ENTRIES` — 77 KiB of release copy — is imported on the
 * far side of a lazy boundary. `<WhatsNewSection>` deliberately takes its
 * entries as a prop (it stays trivially testable that way), so somebody has to
 * do the import; doing it in `AppOverlays` would put the whole changelog in
 * the boot payload for every visitor, including the ones who never open it.
 */

import { CHANGELOG_ENTRIES } from '../../data/changelog';
import { WhatsNewSection } from './WhatsNewSection';

export function WhatsNewOverlay({ onClose }: { onClose: () => void }) {
  return <WhatsNewSection entries={CHANGELOG_ENTRIES} onClose={onClose} />;
}
