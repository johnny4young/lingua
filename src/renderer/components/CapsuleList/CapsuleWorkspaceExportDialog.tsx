import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Copy, Download, FileCode2, ShieldCheck } from 'lucide-react';
import { redactSecretsFromCode } from '../../../shared/ai/explainError';
import {
  MAX_CAPSULE_WORKSPACE_FILES,
  MAX_CAPSULE_WORKSPACE_TOTAL_FILE_BYTES,
  buildCapsuleWorkspace,
  capsuleWorkspaceFilename,
  type CapsuleWorkspaceFileInput,
} from '../../../shared/capsuleWorkspace';
import { bucketCapsuleSize, utf8ByteLength, type RunCapsuleV1 } from '../../../shared/runCapsule';
import { formatNumber } from '../../i18n/formatNumber';
import { useTelemetry } from '../../hooks/useTelemetry';
import { useEditorStore } from '../../stores/editorStore';
import { recordTrustEventBestEffort } from '../../stores/trustEventStore';
import { collectCapsuleWorkspaceCandidates } from '../../utils/capsuleWorkspaceCandidates';
import { cn } from '../../utils/cn';
import { saveOrDownloadTextFile } from '../../utils/saveTextFileToDisk';
import { ModalShell } from '../ui/ModalShell';

const CAPSULE_WORKSPACE_MIME = 'application/vnd.lingua.capsule-workspace+json';

export function CapsuleWorkspaceExportDialog({
  capsule,
  onClose,
}: {
  capsule: RunCapsuleV1 | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { track } = useTelemetry();
  const tabs = useEditorStore(state => state.tabs);
  const candidates = useMemo(
    () => (capsule ? collectCapsuleWorkspaceCandidates(tabs, capsule) : []),
    [capsule, tabs]
  );
  const visibleCandidates = useMemo(
    () =>
      candidates.filter(
        candidate =>
          candidate.exclusionReason !== 'workspace-tab' &&
          candidate.exclusionReason !== 'primary-source'
      ),
    [candidates]
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const selected = useMemo(
    () => candidates.filter(candidate => selectedIds.has(candidate.tabId) && candidate.eligible),
    [candidates, selectedIds]
  );
  const selectedBytes = useMemo(
    () => selected.reduce((total, candidate) => total + candidate.byteLength, 0),
    [selected]
  );
  const primarySecretCount = useMemo(
    () => (capsule ? redactSecretsFromCode(capsule.source.content).redactedCount : 0),
    [capsule]
  );
  const hasPossibleSecrets =
    primarySecretCount > 0 || selected.some(candidate => candidate.obviousSecretsDetected > 0);
  const preview =
    visibleCandidates.find(candidate => candidate.tabId === previewId) ??
    visibleCandidates[0] ??
    null;

  const toggleCandidate = useCallback(
    (tabId: string) => {
      const candidate = candidates.find(item => item.tabId === tabId);
      if (!candidate?.eligible) return;
      setMessage(null);
      setReviewed(false);
      if (
        !selectedIds.has(tabId) &&
        (selectedIds.size >= MAX_CAPSULE_WORKSPACE_FILES ||
          selectedBytes + candidate.byteLength > MAX_CAPSULE_WORKSPACE_TOTAL_FILE_BYTES)
      ) {
        setMessage({ tone: 'error', text: t('capsuleWorkspace.error.selectionLimit') });
        return;
      }
      setSelectedIds(current => {
        const next = new Set(current);
        if (next.has(tabId)) {
          next.delete(tabId);
          return next;
        }
        next.add(tabId);
        return next;
      });
    },
    [candidates, selectedBytes, selectedIds, t]
  );

  const buildSelectedArtifact = useCallback(async () => {
    if (!capsule || selected.length === 0 || !reviewed) return null;
    const files: CapsuleWorkspaceFileInput[] = selected.map(candidate => ({
      path: candidate.path,
      language: candidate.language,
      content: candidate.content,
    }));
    const result = await buildCapsuleWorkspace(capsule, files);
    if (!result.ok) {
      setMessage({
        tone: 'error',
        text: t('capsuleWorkspace.error.build', { reason: result.reason }),
      });
      return null;
    }
    track('capsule.exported', {
      trigger: 'list-export-workspace',
      sizeBucket: bucketCapsuleSize(utf8ByteLength(result.json)),
    });
    return result;
  }, [capsule, reviewed, selected, t, track]);

  const handleCopy = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await buildSelectedArtifact();
      if (!result) return;
      if (!navigator.clipboard?.writeText) throw new Error('clipboard-unavailable');
      await navigator.clipboard.writeText(result.json);
      recordWorkspaceTrustEvent(result.value.files.length, 'clipboard');
      setMessage({ tone: 'success', text: t('capsuleWorkspace.notice.copied') });
    } catch {
      setMessage({ tone: 'error', text: t('capsuleWorkspace.error.clipboard') });
    } finally {
      setBusy(false);
    }
  }, [buildSelectedArtifact, busy, t]);

  const handleDownload = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await buildSelectedArtifact();
      if (!result) return;
      await saveOrDownloadTextFile(
        result.json,
        capsuleWorkspaceFilename(result.value),
        CAPSULE_WORKSPACE_MIME,
        {
          onOk: () => {
            recordWorkspaceTrustEvent(result.value.files.length, 'file');
            setMessage({ tone: 'success', text: t('capsuleWorkspace.notice.saved') });
          },
          onError: () => setMessage({ tone: 'error', text: t('capsuleWorkspace.error.save') }),
        }
      );
    } finally {
      setBusy(false);
    }
  }, [buildSelectedArtifact, busy, t]);

  if (!capsule) return null;

  return (
    <ModalShell
      onClose={onClose}
      size="max-w-5xl"
      labelledById="capsule-workspace-export-title"
      headerClose="button"
      closeLabel={t('capsuleWorkspace.action.cancel')}
      header={
        <div>
          <h2
            id="capsule-workspace-export-title"
            className="text-body-lg font-semibold text-fg-base"
          >
            {t('capsuleWorkspace.title')}
          </h2>
          <p className="mt-0.5 text-body-sm text-fg-subtle">{t('capsuleWorkspace.subtitle')}</p>
        </div>
      }
      footerLegend={
        <span className="text-caption text-fg-subtle">
          {t('capsuleWorkspace.selectionSummary', {
            count: selected.length,
            size: formatNumber(selectedBytes, i18n.language),
          })}
        </span>
      }
      trailing={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="button-ghost">
            {t('capsuleWorkspace.action.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={busy || selected.length === 0 || !reviewed}
            data-testid="capsule-workspace-copy"
            className="button-ghost"
          >
            <Copy size={13} aria-hidden="true" />
            {t('capsuleWorkspace.action.copy')}
          </button>
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={busy || selected.length === 0 || !reviewed}
            data-testid="capsule-workspace-download"
            className="button-primary"
          >
            <Download size={13} aria-hidden="true" />
            {t('capsuleWorkspace.action.download')}
          </button>
        </div>
      }
    >
      <div data-testid="capsule-workspace-export-dialog" className="space-y-3">
        <div className="grid gap-3 md:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)]">
          <section className="min-h-0 rounded-lg border border-border-subtle bg-bg-inset/50 p-3">
            <div className="flex items-start gap-2">
              <ShieldCheck
                size={16}
                className="mt-0.5 shrink-0 text-accent-fg"
                aria-hidden="true"
              />
              <div>
                <h3 className="text-body-sm font-semibold text-fg-base">
                  {t('capsuleWorkspace.primary.title')}
                </h3>
                <p className="mt-0.5 text-caption text-fg-subtle">
                  {t('capsuleWorkspace.primary.description')}
                </p>
                <p className="mt-1 font-mono text-eyebrow text-fg-muted">
                  {capsule.tab.name ?? capsule.tab.language} · {capsule.tab.language}
                </p>
              </div>
            </div>

            <h3 className="mt-4 text-caption font-semibold uppercase tracking-wider text-fg-subtle">
              {t('capsuleWorkspace.files.title')}
            </h3>
            <p className="mt-1 text-caption text-fg-subtle">
              {t('capsuleWorkspace.files.description')}
            </p>
            <div className="mt-2 max-h-[220px] space-y-1 overflow-auto pr-1">
              {visibleCandidates.length === 0 ? (
                <p
                  data-testid="capsule-workspace-empty"
                  className="rounded border border-dashed border-border-subtle p-3 text-caption text-fg-subtle"
                >
                  {t('capsuleWorkspace.files.empty')}
                </p>
              ) : (
                visibleCandidates.map(candidate => (
                  <div
                    key={candidate.tabId}
                    data-testid="capsule-workspace-candidate"
                    className={cn(
                      'flex items-start gap-2 rounded-md border p-2',
                      preview?.tabId === candidate.tabId
                        ? 'border-border-strong bg-bg-panel-alt'
                        : 'border-border-subtle bg-bg-panel/40'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(candidate.tabId)}
                      disabled={!candidate.eligible}
                      onChange={() => toggleCandidate(candidate.tabId)}
                      data-testid={`capsule-workspace-select-${candidate.tabId}`}
                      aria-label={t('capsuleWorkspace.files.selectAria', { path: candidate.path })}
                      className="focus-ring mt-0.5 h-3.5 w-3.5 shrink-0 accent-accent"
                    />
                    <button
                      type="button"
                      onClick={() => setPreviewId(candidate.tabId)}
                      className="focus-ring min-w-0 flex-1 rounded text-left"
                    >
                      <span className="block truncate font-mono text-caption text-fg-base">
                        {candidate.path}
                      </span>
                      <span className="mt-0.5 block text-eyebrow text-fg-subtle">
                        {candidate.language} · {formatNumber(candidate.byteLength, i18n.language)} B
                      </span>
                      {candidate.exclusionReason ? (
                        <span className="mt-0.5 block text-eyebrow text-warning-fg">
                          {t(`capsuleWorkspace.files.excluded.${candidate.exclusionReason}`)}
                        </span>
                      ) : null}
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="min-h-0 overflow-hidden rounded-lg border border-border-subtle bg-bg-inset/50">
            <header className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
              <div className="min-w-0">
                <h3 className="text-body-sm font-semibold text-fg-base">
                  {t('capsuleWorkspace.preview.title')}
                </h3>
                <p className="truncate font-mono text-eyebrow text-fg-subtle">
                  {preview?.path ?? t('capsuleWorkspace.preview.empty')}
                </p>
              </div>
              <FileCode2 size={15} className="shrink-0 text-fg-muted" aria-hidden="true" />
            </header>
            {preview ? (
              <pre
                data-testid="capsule-workspace-preview-content"
                className="h-[250px] overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-body-sm text-fg-base"
              >
                {preview.content || '/* empty */'}
              </pre>
            ) : (
              <div className="flex h-[250px] items-center justify-center p-6 text-center text-body-sm text-fg-subtle">
                {t('capsuleWorkspace.preview.empty')}
              </div>
            )}
          </section>
        </div>

        <div className="rounded-lg border border-border-subtle bg-bg-inset/60 p-3">
          <div className="flex items-start gap-2 text-caption text-fg-subtle">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-accent-fg" aria-hidden="true" />
            <p>{t('capsuleWorkspace.privacy.localOnly')}</p>
          </div>
          {hasPossibleSecrets ? (
            <div
              role="alert"
              data-testid="capsule-workspace-secret-warning"
              className="mt-2 flex items-start gap-2 rounded border border-warning-border bg-warning-bg p-2 text-caption text-warning-fg"
            >
              <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              <p>{t('capsuleWorkspace.privacy.secretWarning')}</p>
            </div>
          ) : null}
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-body-sm text-fg-base">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={selected.length === 0}
              onChange={event => setReviewed(event.target.checked)}
              data-testid="capsule-workspace-review-confirmation"
              className="focus-ring mt-0.5 h-3.5 w-3.5 shrink-0 accent-accent"
            />
            <span>{t('capsuleWorkspace.privacy.reviewConfirmation')}</span>
          </label>
        </div>

        {message ? (
          <p
            role={message.tone === 'error' ? 'alert' : 'status'}
            data-testid="capsule-workspace-message"
            className={cn(
              'rounded-md border px-3 py-2 text-caption',
              message.tone === 'error'
                ? 'border-error-border bg-error-bg text-error-fg'
                : 'border-success-border bg-success-bg text-success-fg'
            )}
          >
            {message.text}
          </p>
        ) : null}
      </div>
    </ModalShell>
  );
}

function recordWorkspaceTrustEvent(fileCount: number, destination: 'clipboard' | 'file') {
  recordTrustEventBestEffort({
    feature: 'capsule-export',
    action: 'exported',
    sensitivity: 'medium',
    summary: `${fileCount}-file capsule workspace exported to ${destination}`,
  });
}
