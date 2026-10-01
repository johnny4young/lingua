import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { computeContentHash, type RunCapsuleV1 } from '../../../shared/runCapsule';
import { capsuleVerificationBlocker } from '../../../shared/capsuleVerification';
import {
  parseCapsuleRegressionSuite,
  serializeCapsuleRegressionSuite,
  MAX_REGRESSION_SUITE_BYTES,
  type CapsuleRegressionSuiteV1,
} from '../../../shared/capsuleRegressionSuite';
import { useEditorStore } from '../../stores/editorStore';
import { useProjectStore } from '../../stores/projectStore';
import { saveOrDownloadTextFile } from '../../utils/saveTextFileToDisk';
import { ModalShell } from '../ui/ModalShell';

/** Preparing, reading and exporting a suite are inert; only the explicit CLI executes it. */
export function CapsuleRegressionExportDialog({
  capsule,
  onClose,
}: {
  capsule: RunCapsuleV1 | null;
  onClose: () => void;
}) {
  return capsule ? (
    <RegressionDialog key={capsule.capsuleId} capsule={capsule} onClose={onClose} />
  ) : null;
}
function RegressionDialog({ capsule, onClose }: { capsule: RunCapsuleV1; onClose: () => void }) {
  const { t } = useTranslation();
  const titleId = useId();
  const tabs = useEditorStore(state => state.tabs);
  const rootId = useProjectStore(state => state.currentProject?.rootId);
  const candidates = useMemo(
    () =>
      tabs.filter(
        tab =>
          capsule &&
          tab.language === capsule.tab.language &&
          tab.rootId === rootId &&
          rootId &&
          tab.relativePath &&
          tab.filePath &&
          tab.kind !== 'notebook'
      ),
    [tabs, rootId, capsule]
  );
  const [selected, setSelected] = useState('');
  const [name, setName] = useState(capsule?.tab.name ?? '');
  const [reviewedSnapshot, setReviewedSnapshot] = useState<string | null>(null);
  const importGeneration = useRef(0);
  const importInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [imported, setImported] = useState('');
  const target = candidates.find(tab => tab.id === selected);
  const snapshot = JSON.stringify([
    name,
    target?.id,
    target?.relativePath,
    target?.content,
    capsule,
  ]);
  const reviewed = reviewedSnapshot === snapshot;
  useEffect(
    () => () => {
      importGeneration.current += 1;
    },
    []
  );
  const blocker = capsule ? capsuleVerificationBlocker(capsule) : null;
  const exportCase = async () => {
    if (!target?.relativePath || !name.trim() || !reviewed || blocker) return;
    setBusy(true);
    setMessage('');
    try {
      if ((await computeContentHash(capsule.source.content)) !== capsule.source.contentHash)
        throw new Error('hash');
      const artifact: CapsuleRegressionSuiteV1 = {
        kind: 'lingua-regression-suite',
        suiteVersion: 1,
        cases: [
          {
            id: crypto.randomUUID(),
            name: name.trim(),
            target: target.relativePath,
            baseline: capsule,
          },
        ],
      };
      const json = serializeCapsuleRegressionSuite(artifact);
      await saveOrDownloadTextFile(json, 'regression.lingua-suite.json', 'application/json', {
        onOk: () => setMessage(t('capsuleRegression.saved')),
        onError: () => setMessage(t('capsuleRegression.invalid')),
      });
    } catch {
      setMessage(t('capsuleRegression.invalid'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalShell
      onClose={onClose}
      size="max-w-4xl"
      labelledById={titleId}
      headerClose="button"
      closeLabel={t('capsuleWorkspace.action.cancel')}
      header={<h2 id={titleId}>{t('capsuleRegression.title')}</h2>}
    >
      <div className="space-y-3 p-4" data-testid="capsule-regression-dialog">
        <p>{t('capsuleRegression.notice')}</p>
        <label className="block">
          {t('capsuleRegression.name')}
          <input
            className="w-full rounded border border-border-subtle bg-bg-inset p-2"
            value={name}
            maxLength={200}
            onChange={event => {
              setName(event.target.value);
              setReviewedSnapshot(null);
            }}
          />
        </label>
        <label className="block">
          {t('capsuleRegression.target')}
          <select
            className="w-full rounded border border-border-subtle bg-bg-inset p-2"
            value={selected}
            onChange={event => {
              setSelected(event.target.value);
              setReviewedSnapshot(null);
            }}
          >
            <option value="">{t('capsuleRegression.choose')}</option>
            {candidates.map(tab => (
              <option key={tab.id} value={tab.id}>
                {tab.relativePath}
              </option>
            ))}
          </select>
        </label>
        {!candidates.length && <p>{t('capsuleRegression.noTargets')}</p>}
        {blocker && <p role="status">{t('capsuleRegression.incomplete')}</p>}
        {target && (
          <>
            <h3>{t('capsuleRegression.preview')}</h3>
            {target.isDirty && <p>{t('capsuleRegression.dirty')}</p>}
            <pre
              className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-bg-panel-alt p-2"
              data-testid="regression-target-preview"
            >
              {target.content}
            </pre>
            <h3>{t('capsuleRegression.baseline')}</h3>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-bg-panel-alt p-2">
              {JSON.stringify(capsule, null, 2)}
            </pre>
          </>
        )}
        <label className="block">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={event => setReviewedSnapshot(event.target.checked ? snapshot : null)}
          />{' '}
          {t('capsuleRegression.review')}
        </label>
        <button
          type="button"
          className="rounded border border-border-subtle px-3 py-2"
          disabled={!target || !name.trim() || !reviewed || busy || Boolean(blocker)}
          onClick={() => {
            void exportCase();
          }}
        >
          {t('capsuleRegression.export')}
        </button>
        <button
          type="button"
          className="block rounded border border-border-subtle px-3 py-2"
          onClick={() => importInput.current?.click()}
        >
          {t('capsuleRegression.inspect')}
        </button>
        <input
          ref={importInput}
          className="hidden"
          aria-label={t('capsuleRegression.inspect')}
          type="file"
          accept=".json"
          onChange={async event => {
            const generation = ++importGeneration.current;
            const file = event.target.files?.[0];
            if (!file) return;
            setImported('');
            setMessage('');
            if (file.size > MAX_REGRESSION_SUITE_BYTES) {
              setMessage(t('capsuleRegression.invalid'));
              return;
            }
            try {
              const raw = await file.text();
              if (generation !== importGeneration.current) return;
              const parsed = parseCapsuleRegressionSuite(raw);
              if (!parsed.ok) throw new Error('invalid');
              setImported(JSON.stringify(parsed.suite, null, 2));
            } catch {
              if (generation !== importGeneration.current) return;
              setMessage(t('capsuleRegression.invalid'));
            }
          }}
        />
        {imported && (
          <pre
            className="max-h-64 overflow-auto whitespace-pre-wrap"
            data-testid="regression-import-preview"
          >
            {imported}
          </pre>
        )}
        {message && <p role="status">{message}</p>}
      </div>
    </ModalShell>
  );
}
