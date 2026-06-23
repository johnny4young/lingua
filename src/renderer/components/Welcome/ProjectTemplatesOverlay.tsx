// SPDX-License-Identifier: MIT
/**
 * RL-103 Slice 1 fold C — Project templates overlay.
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

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ProjectTemplatesPanel } from './ProjectTemplatesPanel';

export function ProjectTemplatesOverlay({
  onClose,
}: {
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const closeRef = useRef(onClose);
  // Keep the latest handler reference fresh for the document
  // keydown listener without re-binding it. `useEffect` (not
  // render) writes the ref so the no-ref-update-during-render
  // lint rule stays satisfied.
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('emptyState.projectTemplates.heading')}
      data-testid="project-templates-overlay"
      className="fixed inset-0 z-40 flex items-start justify-center bg-bg-base/80 p-6 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="mt-12 w-full max-w-5xl">
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
    </div>
  );
}
