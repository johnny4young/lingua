// SPDX-License-Identifier: MIT
/**
 * RL-103 Slice 1 — Project templates panel on the Welcome screen.
 *
 * Renders the 5 curated multi-file scaffolds in the order they're
 * declared in `PROJECT_TEMPLATES` so dashboards + screenshots are
 * deterministic. Clicking a card invokes `useProjectTemplateScaffolder`;
 * the resulting outcome maps to either a transient success notice
 * with a Reveal-in-Finder CTA (fold A) or a typed warning (non-empty
 * dir, error, web-unavailable). Cancellation is silent — the picker
 * dialog itself is the user feedback.
 *
 * Web build branch: the cards are still visible (so users on the
 * preview can read what the desktop app offers) but the click resolves
 * to the `web-unavailable` notice instead of a folder picker. This
 * matches the Toolbar / FileTree pattern of showing affordances with
 * inline "desktop only" hints rather than hiding them entirely — the
 * web build's job is to motivate the download, not to pretend the
 * feature doesn't exist.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PROJECT_TEMPLATES } from '../../data/projectTemplates';
import type { ProjectTemplateV1 } from '../../../shared/projectTemplate';
import type { RelativePath, RootId } from '../../../shared/fs/brandedIds';
import {
  languageBadgeClass,
  languageLabel,
} from '../../utils/languageMeta';
import type { Language } from '../../types';
import {
  useProjectTemplateScaffolder,
  type ScaffoldResult,
} from '../../hooks/useProjectTemplateScaffolder';

type NoticeState =
  | { kind: 'idle' }
  | {
      kind: 'success';
      template: ProjectTemplateV1;
      rootId: RootId;
      rootPath: string;
      entryFile: RelativePath;
    }
  | { kind: 'non-empty-dir' }
  | { kind: 'web-unavailable' }
  | { kind: 'error'; message: string };

export function ProjectTemplatesPanel() {
  const { t } = useTranslation();
  const { scaffold } = useProjectTemplateScaffolder();
  const [notice, setNotice] = useState<NoticeState>({ kind: 'idle' });
  const [busyTemplateId, setBusyTemplateId] = useState<string | null>(null);

  const isWebBuild = useMemo(
    () =>
      typeof window !== 'undefined' && window.lingua?.platform === 'web',
    []
  );

  async function handleClick(template: ProjectTemplateV1) {
    if (busyTemplateId) return;
    if (isWebBuild) {
      setNotice({ kind: 'web-unavailable' });
      return;
    }
    setBusyTemplateId(template.id);
    setNotice({ kind: 'idle' });
    try {
      const result = await scaffold(template);
      setNotice(noticeForResult(template, result));
    } finally {
      setBusyTemplateId(null);
    }
  }

  async function handleReveal() {
    if (notice.kind !== 'success') return;
    try {
      await window.lingua.fs.revealInFinder(notice.rootId, notice.entryFile);
    } catch {
      // Best-effort surface; if the OS rejects (path moved, perms),
      // we swallow and keep the notice — the user can still navigate
      // to the file from the editor tab that's already open.
    }
  }

  return (
    <section
      data-testid="welcome-project-templates"
      className="animate-rise-in overflow-hidden rounded-4xl border border-border-subtle/70 bg-bg-panel shadow-[0_18px_60px_color-mix(in_srgb,var(--color-accent)_8%,transparent)]"
    >
      <header className="flex items-start justify-between gap-3 border-b border-border-subtle/60 bg-bg-panel-alt/60 px-5 py-4">
        <div>
          <p className="panel-title">
            {t('emptyState.projectTemplates.heading')}
          </p>
          <p className="mt-1 max-w-2xl text-body text-fg-muted">
            {t('emptyState.projectTemplates.subheading')}
          </p>
        </div>
        <span className="status-pill">
          {t('emptyState.projectTemplates.count', {
            count: PROJECT_TEMPLATES.length,
          })}
        </span>
      </header>

      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {PROJECT_TEMPLATES.map((template) => {
          const busy = busyTemplateId === template.id;
          return (
            <article
              key={template.id}
              data-testid={`welcome-project-template-${template.id}`}
              className="group flex flex-col gap-3 rounded-2xl border border-border-subtle/70 bg-bg-panel-alt/65 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:bg-bg-panel"
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-eyebrow font-bold uppercase tracking-[0.16em] ${languageBadgeClass(template.language as Language)}`}
                >
                  {languageLabel(template.language as Language)}
                </span>
                <span className="text-eyebrow font-medium uppercase tracking-[0.12em] text-fg-muted">
                  {t('emptyState.projectTemplates.fileCount', {
                    count: template.files.length,
                  })}
                </span>
              </div>
              <h3 className="font-display text-body-lg font-semibold tracking-[-0.02em] text-fg-base">
                {t(template.labelKey)}
              </h3>
              <p className="text-body-sm leading-6 text-fg-muted">
                {t(template.descriptionKey)}
              </p>
              <button
                type="button"
                // Any in-flight scaffold locks every card. The
                // implementation just checks `busyTemplateId !== null`
                // because `busy` is the per-card alias used for the
                // spinner label, not the disable gate.
                disabled={busyTemplateId !== null}
                onClick={() => {
                  void handleClick(template);
                }}
                data-testid={`welcome-project-template-${template.id}-action`}
                className="mt-auto inline-flex items-center justify-center gap-2 self-start rounded-full border border-accent/40 bg-accent/10 px-3 py-1.5 text-body-sm font-semibold text-accent-fg transition-colors hover:bg-accent/20 disabled:opacity-60"
              >
                {busy
                  ? '…'
                  : t('emptyState.projectTemplates.action')}
              </button>
            </article>
          );
        })}
      </div>

      {notice.kind !== 'idle' ? (
        <div
          role="status"
          data-testid={`welcome-project-template-notice-${notice.kind}`}
          className={noticeContainerClass(notice.kind)}
        >
          <NoticeBody
            notice={notice}
            onReveal={() => {
              void handleReveal();
            }}
            onDismiss={() => setNotice({ kind: 'idle' })}
          />
        </div>
      ) : null}
    </section>
  );
}

function NoticeBody(props: {
  notice: NoticeState;
  onReveal: () => void;
  onDismiss: () => void;
}) {
  const { notice, onReveal, onDismiss } = props;
  const { t } = useTranslation();
  if (notice.kind === 'idle') return null;
  if (notice.kind === 'success') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-body font-semibold text-fg-base">
            {t('emptyState.projectTemplates.successHeading', {
              label: t(notice.template.labelKey),
            })}
          </p>
          <p className="mt-0.5 text-body-sm text-fg-muted">
            {t('emptyState.projectTemplates.successBody', {
              count: notice.template.files.length,
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReveal}
            data-testid="welcome-project-template-reveal"
            className="rounded-full border border-border-subtle/70 bg-bg-panel-alt px-3 py-1.5 text-body-sm font-semibold text-fg-base hover:bg-bg-panel"
          >
            {t('emptyState.projectTemplates.revealInFinder')}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-full px-2 py-1.5 text-body-sm font-medium text-fg-muted hover:text-fg-base"
          >
            {t('emptyState.projectTemplates.dismiss')}
          </button>
        </div>
      </div>
    );
  }
  const message =
    notice.kind === 'non-empty-dir'
      ? t('emptyState.projectTemplates.nonEmptyDir')
      : notice.kind === 'web-unavailable'
        ? t('emptyState.projectTemplates.webUnavailable')
        : notice.message;
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-body-sm leading-6 text-fg-base">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-full px-2 py-1 text-body-sm font-medium text-fg-muted hover:text-fg-base"
      >
        {t('emptyState.projectTemplates.dismiss')}
      </button>
    </div>
  );
}

function noticeContainerClass(
  kind: Exclude<NoticeState['kind'], 'idle'>
): string {
  const base = 'border-t px-5 py-3';
  if (kind === 'success') {
    return `${base} border-emerald-500/30 bg-emerald-500/5`;
  }
  if (kind === 'error') {
    return `${base} border-rose-500/30 bg-rose-500/5`;
  }
  return `${base} border-amber-500/30 bg-amber-500/5`;
}

function noticeForResult(
  template: ProjectTemplateV1,
  result: ScaffoldResult
): NoticeState {
  switch (result.kind) {
    case 'success':
      return {
        kind: 'success',
        template,
        rootId: result.rootId,
        rootPath: result.rootPath,
        entryFile: result.entryFile,
      };
    case 'canceled':
      return { kind: 'idle' };
    case 'non-empty-dir':
      return { kind: 'non-empty-dir' };
    case 'web-unavailable':
      return { kind: 'web-unavailable' };
    case 'error':
      return { kind: 'error', message: result.message };
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}
