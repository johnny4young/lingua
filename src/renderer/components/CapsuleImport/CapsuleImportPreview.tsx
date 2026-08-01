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
import { AlertTriangle, ExternalLink, FileJson, Files, Globe, ShieldCheck } from 'lucide-react';
import type { RunCapsuleV1 } from '../../../shared/runCapsule';
import { utf8ByteLength } from '../../../shared/runCapsule';
import type {
  CapsuleWorkspaceFileV1,
  CapsuleWorkspaceV1,
} from '../../../shared/capsuleWorkspace';
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
  workspace?: CapsuleWorkspaceV1;
  onOpenWorkspaceFile?: (file: CapsuleWorkspaceFileV1) => void;
}

type PreviewTab = 'source' | 'result' | 'environment' | 'files';

const PREVIEW_TABS: ReadonlyArray<{ id: PreviewTab; labelKey: string }> = [
  { id: 'source', labelKey: 'capsuleImport.preview.tab.source' },
  { id: 'result', labelKey: 'capsuleImport.preview.tab.result' },
  { id: 'environment', labelKey: 'capsuleImport.preview.tab.environment' },
];

export function CapsuleImportPreview({
  capsule,
  byteLength,
  workspace,
  onOpenWorkspaceFile,
}: CapsuleImportPreviewProps) {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<PreviewTab>('source');
  const effectiveActiveTab = activeTab === 'files' && !workspace ? 'source' : activeTab;
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
        {[
          ...PREVIEW_TABS,
          ...(workspace
            ? [{ id: 'files' as const, labelKey: 'capsuleImport.preview.tab.files' }]
            : []),
        ].map((tab) => {
          const isActive = effectiveActiveTab === tab.id;
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
        aria-label={t(`capsuleImport.preview.tab.${effectiveActiveTab}`)}
        data-testid={`capsule-import-preview-panel-${effectiveActiveTab}`}
        className="flex-1 min-h-0 overflow-auto p-3 font-mono text-body-sm"
      >
        {effectiveActiveTab === 'source' ? (
          <SourcePanel capsule={capsule} />
        ) : null}
        {effectiveActiveTab === 'result' ? <ResultPanel capsule={capsule} /> : null}
        {effectiveActiveTab === 'environment' ? (
          <EnvironmentPanel capsule={capsule} />
        ) : null}
        {effectiveActiveTab === 'files' && workspace ? (
          <WorkspaceFilesPanel workspace={workspace} onOpenFile={onOpenWorkspaceFile} />
        ) : null}
      </div>
    </div>
  );
}

function WorkspaceFilesPanel({
  workspace,
  onOpenFile,
}: {
  workspace: CapsuleWorkspaceV1;
  onOpenFile?: (file: CapsuleWorkspaceFileV1) => void;
}) {
  const { t, i18n } = useTranslation();
  const [pickedPath, setPickedPath] = useState<string | null>(null);
  const selected =
    workspace.files.find(file => file.path === pickedPath) ?? workspace.files[0] ?? null;
  return (
    <div className="grid min-h-[260px] gap-3 font-sans md:grid-cols-[minmax(180px,0.7fr)_minmax(0,1.3fr)]">
      <section>
        <div className="mb-2 flex items-start gap-2 rounded border border-border-subtle bg-bg-inset/60 p-2 text-caption text-fg-subtle">
          <ShieldCheck size={13} className="mt-0.5 shrink-0 text-accent-fg" aria-hidden="true" />
          <p>{t('capsuleImport.preview.files.localOnly')}</p>
        </div>
        {workspace.privacy.obviousSecretsDetected > 0 ? (
          <div
            role="alert"
            className="mb-2 flex items-start gap-2 rounded border border-warning-border bg-warning-bg p-2 text-caption text-warning-fg"
          >
            <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p>
              {t('capsuleImport.preview.files.secretWarning', {
                count: workspace.privacy.obviousSecretsDetected,
              })}
            </p>
          </div>
        ) : null}
        <div className="space-y-1">
          {workspace.files.map(file => (
            <button
              key={file.path}
              type="button"
              onClick={() => setPickedPath(file.path)}
              aria-pressed={selected?.path === file.path}
              data-testid="capsule-workspace-viewer-file"
              className={cn(
                'focus-ring block w-full rounded border px-2 py-1.5 text-left',
                selected?.path === file.path
                  ? 'border-border-strong bg-bg-panel-alt'
                  : 'border-border-subtle bg-bg-inset/40 hover:bg-bg-panel-alt'
              )}
            >
              <span className="block truncate font-mono text-caption text-fg-base">
                {file.path}
              </span>
              <span className="mt-0.5 block text-eyebrow text-fg-subtle">
                {file.language} · {formatNumber(utf8ByteLength(file.content), i18n.language)} B
              </span>
            </button>
          ))}
        </div>
      </section>
      <section className="min-h-0 overflow-hidden rounded border border-border-subtle bg-bg-inset/50">
        {selected ? (
          <>
            <header className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-caption text-fg-base">{selected.path}</p>
                <p className="mt-0.5 font-mono text-eyebrow text-fg-subtle">
                  {t('capsuleImport.preview.files.hashSummary', {
                    hash: selected.contentHash.slice(0, 12),
                  })}
                </p>
              </div>
              {onOpenFile ? (
                <button
                  type="button"
                  onClick={() => onOpenFile(selected)}
                  data-testid="capsule-workspace-viewer-open-file"
                  className="button-ghost shrink-0"
                >
                  <ExternalLink size={12} aria-hidden="true" />
                  {t('capsuleImport.preview.files.open')}
                </button>
              ) : (
                <Files size={14} className="shrink-0 text-fg-muted" aria-hidden="true" />
              )}
            </header>
            <pre
              data-testid="capsule-workspace-viewer-content"
              className="max-h-[300px] overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-body-sm text-fg-base"
            >
              {selected.content || '/* empty */'}
            </pre>
          </>
        ) : null}
      </section>
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
