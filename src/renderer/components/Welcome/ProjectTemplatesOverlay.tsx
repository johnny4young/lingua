// SPDX-License-Identifier: MIT
/**
 * Project templates overlay.
 *
 * Modal wrapper around `ProjectTemplatesPanel` so the command palette
 * entry `action-new-project-from-template` can surface the cards even
 * when the user already has tabs open (in which case the Welcome
 * screen is not on screen). The overlay reuses the same panel
 * component so card layout, copy, and scaffold behavior stay in lock
 * step between the two surfaces — there is no duplicate UI to keep
 * synchronized.
 *
 * Escape + click-outside dismiss the overlay; the wrapped panel
 * still owns its own notice state, so a successful scaffold prompts
 * the user to dismiss the overlay manually after they tap "Show in
 * Finder" if they want to switch back to the editor.
 */

import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { OverlayBackdrop } from '../ui/chrome';
import { ProjectTemplatesPanel } from './ProjectTemplatesPanel';

export function ProjectTemplatesOverlay({
  onClose,
}: {
  onClose: () => void;
}) {
  const { t } = useTranslation();

  // The shared backdrop sits above the floating pill and owns focus
  // move/trap/restore; Escape is handled here so it closes only this overlay.
  const handleEscape = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return (
    <OverlayBackdrop
      portal
      align="top"
      className="overflow-y-auto pb-6"
      onClose={onClose}
      onKeyDown={handleEscape}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('emptyState.projectTemplates.heading')}
        data-testid="project-templates-overlay"
        className="w-full max-w-5xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-h3 font-semibold tracking-[-0.02em] text-fg-base">
            {t('emptyState.projectTemplates.heading')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            data-testid="project-templates-overlay-close"
            className="rounded-full px-3 py-1 text-body-sm font-medium text-fg-muted hover:text-fg-base"
          >
            {t('emptyState.projectTemplates.dismiss')}
          </button>
        </div>
        <ProjectTemplatesPanel />
      </div>
    </OverlayBackdrop>
  );
}
