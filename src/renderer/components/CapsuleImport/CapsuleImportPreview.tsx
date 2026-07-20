/**
 * implementation — Pure preview component.
 *
 * Renders a decoded `RunCapsuleV1` as a read-only panel with three
 * tabs (Source / Result / Environment) plus a metadata header strip.
 *
 * Pure means: no IPC, no telemetry, no editorStore writes. The
 * parent `<CapsuleImportOverlay>` owns those side effects. Splitting
 * the surface here keeps the test surface tiny (one prop, one
 * snapshot) and lets the overlay swap in different action bars
 * without touching layout.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, FileJson, Globe } from 'lucide-react';
import type { RunCapsuleV1 } from '../../../shared/runCapsule';
import { utf8ByteLength } from '../../../shared/runCapsule';
import { formatNumber } from '../../i18n/formatNumber';
import { cn } from '../../utils/cn';

export interface CapsuleImportPreviewProps {
  capsule: RunCapsuleV1;
  /**
   * Bytes the source occupied in the import payload BEFORE decode.
   * Surfaced in the metadata strip alongside the bucket so the user
   * can sanity-check the truncation hint.
   */
  byteLength: number;
}

type PreviewTab = 'source' | 'result' | 'environment';

const PREVIEW_TABS: ReadonlyArray<{ id: PreviewTab; labelKey: string }> = [
  { id: 'source', labelKey: 'capsuleImport.preview.tab.source' },
  { id: 'result', labelKey: 'capsuleImport.preview.tab.result' },
  { id: 'environment', labelKey: 'capsuleImport.preview.tab.environment' },
];

export function CapsuleImportPreview({
  capsule,
  byteLength,
}: CapsuleImportPreviewProps) {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<PreviewTab>('source');
  const omittedFields = capsule.privacy?.omittedFields ?? [];
  const isHttpCapsule = capsule.tab.language === 'http';

  return (
    <div
      data-testid="capsule-import-preview"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-surface/30"
    >
      <header
        data-testid="capsule-import-preview-metadata"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/40 bg-background-elevated/60 px-3 py-2 text-caption text-muted"
      >
        <span
          data-testid="capsule-import-preview-metadata-language"
          className="inline-flex items-center gap-1.5 rounded bg-surface-strong/60 px-1.5 py-0.5 font-mono text-eyebrow uppercase tracking-wider text-foreground"
        >
          {isHttpCapsule ? (
            <Globe size={10} aria-hidden="true" />
          ) : (
            <FileJson size={10} aria-hidden="true" />
          )}
          {capsule.tab.language}
        </span>
        <span data-testid="capsule-import-preview-metadata-runner">
          {t('capsuleImport.preview.metadata.runner')}:{' '}
          <span className="font-mono text-foreground">
            {capsule.environment?.runner ?? '—'}
          </span>
        </span>
        <span data-testid="capsule-import-preview-metadata-appversion">
          {t('capsuleImport.preview.metadata.appVersion')}:{' '}
          <span className="font-mono text-foreground">
            {capsule.appVersion}
          </span>
        </span>
        <span data-testid="capsule-import-preview-metadata-created">
          {t('capsuleImport.preview.metadata.createdAt')}:{' '}
          <span className="font-mono text-foreground">
            {capsule.createdAt}
          </span>
        </span>
        <span data-testid="capsule-import-preview-metadata-size">
          {t('capsuleImport.preview.metadata.size')}:{' '}
          <span className="font-mono text-foreground">
            {formatNumber(byteLength, i18n.language)} B
          </span>
        </span>
      </header>
      {omittedFields.length > 0 ? (
        <div
          role="alert"
          data-testid="capsule-import-preview-omitted-banner"
          className="flex items-start gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-caption text-amber-200"
        >
          <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">
              {t('capsuleImport.preview.omittedFields')}
            </p>
            <p className="mt-0.5 font-mono text-eyebrow text-amber-100/80">
              {omittedFields.join(', ')}
            </p>
          </div>
        </div>
      ) : null}
      <div
        role="tablist"
        aria-label={t('capsuleImport.preview.tablistLabel')}
        className="flex shrink-0 items-center gap-1 border-b border-border/40 bg-surface/40 px-2 py-1.5 text-caption"
      >
        {PREVIEW_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-testid={`capsule-import-preview-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'rounded px-2 py-1 text-body-sm',
                isActive
                  ? 'bg-background-elevated text-foreground'
                  : 'text-muted hover:bg-surface-strong/60 hover:text-foreground'
              )}
            >
              {t(tab.labelKey)}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        aria-label={t(`capsuleImport.preview.tab.${activeTab}`)}
        data-testid={`capsule-import-preview-panel-${activeTab}`}
        className="flex-1 min-h-0 overflow-auto p-3 font-mono text-body-sm"
      >
        {activeTab === 'source' ? (
          <SourcePanel capsule={capsule} />
        ) : null}
        {activeTab === 'result' ? <ResultPanel capsule={capsule} /> : null}
        {activeTab === 'environment' ? (
          <EnvironmentPanel capsule={capsule} />
        ) : null}
      </div>
    </div>
  );
}

function SourcePanel({ capsule }: { capsule: RunCapsuleV1 }) {
  const content = capsule.source.content ?? '';
  return (
    <pre
      data-testid="capsule-import-preview-source-content"
      className="whitespace-pre-wrap break-all rounded bg-background-elevated/40 p-2 text-foreground"
    >
      {content.length === 0 ? '/* (empty source) */' : content}
    </pre>
  );
}

function ResultPanel({ capsule }: { capsule: RunCapsuleV1 }) {
  const { t, i18n } = useTranslation();
  const { result } = capsule;
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const omittedStdout = capsule.privacy.omittedFields?.includes('result.stdout');
  const omittedStderr = capsule.privacy.omittedFields?.includes('result.stderr');
  return (
    <div className="space-y-2">
      <div data-testid="capsule-import-preview-result-status" className="text-muted">
        <span className="font-semibold text-foreground">{result.status}</span>{' '}
        · {Math.max(0, Math.round(result.durationMs))} ms
      </div>
      {result.errorMessage ? (
        <pre
          data-testid="capsule-import-preview-result-error"
          className="whitespace-pre-wrap rounded bg-rose-500/10 p-2 text-rose-200"
        >
          {result.errorMessage}
        </pre>
      ) : null}
      <section>
        <h4 className="text-eyebrow uppercase tracking-wider text-muted">
          <code>stdout</code>
          {omittedStdout ? (
            <span
              data-testid="capsule-import-preview-result-stdout-truncated"
              className="ml-1 normal-case text-amber-300"
            >
              · {t('capsuleImport.preview.truncated', {
                size: formatNumber(utf8ByteLength(stdout), i18n.language),
              })}
            </span>
          ) : null}
        </h4>
        <pre
          data-testid="capsule-import-preview-result-stdout"
          className="mt-1 max-h-[200px] overflow-auto whitespace-pre-wrap break-all rounded bg-background-elevated/40 p-2 text-foreground"
        >
          {stdout.length === 0 ? '—' : stdout}
        </pre>
      </section>
      <section>
        <h4 className="text-eyebrow uppercase tracking-wider text-muted">
          <code>stderr</code>
          {omittedStderr ? (
            <span
              data-testid="capsule-import-preview-result-stderr-truncated"
              className="ml-1 normal-case text-amber-300"
            >
              · {t('capsuleImport.preview.truncated', {
                size: formatNumber(utf8ByteLength(stderr), i18n.language),
              })}
            </span>
          ) : null}
        </h4>
        <pre
          data-testid="capsule-import-preview-result-stderr"
          className="mt-1 max-h-[200px] overflow-auto whitespace-pre-wrap break-all rounded bg-background-elevated/40 p-2 text-foreground"
        >
          {stderr.length === 0 ? '—' : stderr}
        </pre>
      </section>
    </div>
  );
}

function EnvironmentPanel({ capsule }: { capsule: RunCapsuleV1 }) {
  const { t } = useTranslation();
  const env = capsule.environment;
  const dependencyJson =
    env.dependencySummary !== undefined
      ? JSON.stringify(env.dependencySummary, null, 2)
      : null;
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-foreground">
        <dt className="text-muted">{t('capsuleImport.preview.metadata.platform')}</dt>
        <dd>{env.platform}</dd>
        <dt className="text-muted">{t('capsuleImport.preview.metadata.runner')}</dt>
        <dd>{env.runner}</dd>
        {env.git?.branch ? (
          <>
            <dt className="text-muted">{t('capsuleImport.preview.metadata.gitBranch')}</dt>
            <dd>{env.git.branch}</dd>
          </>
        ) : null}
        {env.git?.commit ? (
          <>
            <dt className="text-muted">{t('capsuleImport.preview.metadata.gitCommit')}</dt>
            <dd className="break-all">{env.git.commit}</dd>
          </>
        ) : null}
      </dl>
      {dependencyJson ? (
        <section>
          <h4 className="text-eyebrow uppercase tracking-wider text-muted">
            {t('capsuleImport.preview.metadata.dependencySummary')}
          </h4>
          <pre
            data-testid="capsule-import-preview-environment-deps"
            className="mt-1 whitespace-pre-wrap rounded bg-background-elevated/40 p-2 text-foreground"
          >
            {dependencyJson}
          </pre>
        </section>
      ) : null}
    </div>
  );
}
